FROM node:22-bookworm-slim AS build
WORKDIR /app
# Debian bookworm ships libssl3, but the `-slim` images omit the openssl package itself.
# Without it Prisma cannot detect the libssl version, falls back to a guess, and prints
# "Prisma failed to detect the libssl/openssl version to use" on every invocation. Installing
# it makes engine selection deterministic rather than inferred.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
# The Prisma query engine dynamically links libssl at RUNTIME too, so openssl is required in
# this stage as well — not only where `prisma generate` ran. ca-certificates is needed for
# outbound TLS (Neon, Comtrade, sanctions providers, Resend, object storage).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN groupadd --system cleartrade && useradd --system --gid cleartrade --home /app cleartrade
COPY --from=build --chown=cleartrade:cleartrade /app/node_modules ./node_modules
COPY --from=build --chown=cleartrade:cleartrade /app/.next ./.next
COPY --from=build --chown=cleartrade:cleartrade /app/public ./public
COPY --from=build --chown=cleartrade:cleartrade /app/prisma ./prisma
COPY --from=build --chown=cleartrade:cleartrade /app/scripts ./scripts
COPY --from=build --chown=cleartrade:cleartrade /app/src ./src
COPY --from=build --chown=cleartrade:cleartrade /app/package.json /app/next.config.js /app/tsconfig.json ./
USER cleartrade
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:3000/api/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["npm","start"]
