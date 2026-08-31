#!/bin/bash
set -euo pipefail
umask 077
position_lens_backup="/srv/position-lens-data/backups/$(date -u +%Y%m%d-%H%M%S).sqlite"
/usr/bin/sqlite3 /srv/position-lens-data/app/position-lens.sqlite ".backup '$position_lens_backup'"
find /srv/position-lens-data/backups -maxdepth 1 -type f -name '*.sqlite' -mtime +7 -delete
