FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
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
