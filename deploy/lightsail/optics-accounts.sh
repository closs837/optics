#!/bin/sh
set -eu
exec runuser -u position-lens -- env \
  DATABASE_PATH=/srv/position-lens-data/app/position-lens.sqlite \
  POSITION_LENS_CONFIG=/etc/position-lens/runtime.json \
  /usr/local/bin/node /opt/position-lens/current/deploy/node/accounts.mjs "$@"
