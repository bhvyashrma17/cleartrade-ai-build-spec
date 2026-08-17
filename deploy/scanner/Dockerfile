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

# Write our own clamd.conf rather than sed-patching Debian's.
#
# The previous approach replaced lines matching `^#\?TCPSocket` etc., but bookworm's shipped
# clamd.conf contains no such lines, so those edits silently applied nothing and clamd never
# opened the listener the service expected. Patching a file whose contents we do not control
# fails open and silently; generating the whole config makes the listener deterministic and
# reviewable. `Foreground true` keeps clamd in the container's process tree.
RUN printf '%s\n' \
      'LogFile /var/log/clamav/clamav.log' \
      'LogTime true' \
      'PidFile /run/clamav/clamd.pid' \
      'LocalSocket /run/clamav/clamd.ctl' \
      'LocalSocketMode 660' \
      'FixStaleSocket true' \
      'TCPSocket 3310' \
      'TCPAddr 127.0.0.1' \
      'User clamav' \
      'Foreground true' \
      'DatabaseDirectory /var/lib/clamav' \
      'StreamMaxLength 64M' \
      'MaxThreads 4' \
    > /etc/clamav/clamd.conf

WORKDIR /app
COPY deploy/scanner/server.js deploy/scanner/entrypoint.sh ./
RUN chmod +x entrypoint.sh && chown -R clamav:clamav /app

ENV PORT=3000 CLAMD_SOCKET=/run/clamav/clamd.ctl
EXPOSE 3000

# Readiness requires clamd to answer PING — the service reports unready rather than
# accepting scans it cannot actually perform.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./entrypoint.sh"]
