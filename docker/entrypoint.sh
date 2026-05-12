#!/bin/sh
# Fly volumes mount as root-owned. We chown the mount and drop to `node`
# before exec'ing the server, so the long-running process never runs as root.
set -e
if [ -d /data ]; then
  chown -R node:node /data
fi
exec su-exec node "$@"
