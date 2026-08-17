#!/bin/sh
# Start freshclam (signature updates) and clamd, then the HTTP contract server.
#
# If clamd dies, the container must die with it — a live HTTP server in front of a dead
# engine would return errors that look like transient failures forever, when the correct
# operational signal is "this instance is unhealthy, restart it".
set -eu

grep -E '^(LocalSocket|TCPSocket|TCPAddr|User|Foreground|DatabaseDirectory) ' /etc/clamav/clamd.conf || true
mkdir -p /var/run/clamav
chown clamav:clamav /var/run/clamav
touch /var/log/clamav/clamav.log
chown clamav:clamav /var/log/clamav/clamav.log
tail -n 0 -F /var/log/clamav/clamav.log &

clamd --config-file=/etc/clamav/clamd.conf &
CLAMD_PID=$!

# Wait for clamd to open its socket before accepting traffic.
#
# Tested with the shell's own `-S` (socket exists) rather than a `node -e` connect probe:
# clamd binds the socket only after its signature database is loaded, so existence is an
# accurate readiness signal, and this removes the wait's dependency on `node` resolving on
# PATH inside the Debian image. The previous probe sent stderr to /dev/null, so a missing
# interpreter was indistinguishable from "clamd not up yet" and burned the full timeout.
SOCK="${CLAMD_SOCKET:-/var/run/clamav/clamd.ctl}"
echo "{\"event\":\"clamd_wait\",\"socket\":\"$SOCK\",\"node\":\"$(command -v node || echo missing)\"}"
i=0
while [ $i -lt 240 ]; do
  if [ -S "$SOCK" ]; then
    echo '{"event":"clamd_ready"}'
    break
  fi
  i=$((i+1))
  sleep 1
done

if [ "$i" -ge 240 ]; then
  echo '{"event":"clamd_readiness_timeout"}' >&2
  if [ -f /var/log/clamav/clamav.log ]; then
    tail -n 100 /var/log/clamav/clamav.log >&2
  fi
  exit 1
fi

# Avoid racing a signature update against clamd's initial database load. The image contains
# an initial database; refresh it only after the engine is accepting connections.
freshclam --daemon --checks=4 --quiet &

# Supervise: if clamd exits, take the container down.
( wait $CLAMD_PID; echo '{"event":"clamd_exited"}'; kill -TERM 1 ) &

exec node /app/server.js
