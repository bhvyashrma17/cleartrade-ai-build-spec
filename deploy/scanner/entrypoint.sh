#!/bin/sh
# Start freshclam (signature updates) and clamd, then the HTTP contract server.
#
# If clamd dies, the container must die with it — a live HTTP server in front of a dead
# engine would return errors that look like transient failures forever, when the correct
# operational signal is "this instance is unhealthy, restart it".
set -eu

freshclam --daemon --checks=4 --quiet &

clamd --config-file=/etc/clamav/clamd.conf &
CLAMD_PID=$!

# Wait for clamd to open its socket before accepting traffic.
i=0
while [ $i -lt 120 ]; do
  if node -e "require('node:net').createConnection({host:'127.0.0.1',port:3310}).on('connect',function(){process.exit(0)}).on('error',function(){process.exit(1)})" 2>/dev/null; then
    echo '{"event":"clamd_ready"}'
    break
  fi
  i=$((i+1))
  sleep 1
done

# Supervise: if clamd exits, take the container down.
( wait $CLAMD_PID; echo '{"event":"clamd_exited"}'; kill -TERM 1 ) &

exec node /app/server.js
