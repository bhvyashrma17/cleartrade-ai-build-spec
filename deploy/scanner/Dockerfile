# ClearTrade private malware scanner — ClamAV + the HTTP contract in server.js.
#
# Deployed as the Railway service `cleartrade-scanner`, reachable only over Railway private
# networking. It is deliberately a separate image from the application: the app image should
# not carry a virus engine and its signature database, and the scanner should not carry the
# application's dependencies or secrets.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends clamav-daemon clamav-freshclam nodejs ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Fetch an initial signature database at build time so the service is useful the moment it
# starts. freshclam then keeps it current at runtime. A scanner with no signatures would
# answer "clean" to everything, so this is not an optimisation — it is correctness.
RUN freshclam

# clamd must accept TCP connections from the Node process in this container.
RUN sed -i 's/^#\?TCPSocket.*/TCPSocket 3310/'          /etc/clamav/clamd.conf \
 && sed -i 's/^#\?TCPAddr.*/TCPAddr 127.0.0.1/'         /etc/clamav/clamd.conf \
 && sed -i 's/^#\?StreamMaxLength.*/StreamMaxLength 64M/' /etc/clamav/clamd.conf \
 && sed -i 's/^#\?MaxThreads.*/MaxThreads 4/'           /etc/clamav/clamd.conf \
 && sed -i 's/^#\?LogTime.*/LogTime true/'               /etc/clamav/clamd.conf \
 && sed -i 's/^#\?Foreground.*/Foreground true/'         /etc/clamav/clamd.conf

WORKDIR /app
COPY deploy/scanner/server.js deploy/scanner/entrypoint.sh ./
RUN chmod +x entrypoint.sh && chown -R clamav:clamav /app

ENV PORT=3000 CLAMD_SOCKET=/var/run/clamav/clamd.ctl
EXPOSE 3000

# Readiness requires clamd to answer PING — the service reports unready rather than
# accepting scans it cannot actually perform.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./entrypoint.sh"]
