#!/bin/bash
set -euo pipefail
umask 077
position_lens_stage=$1
position_lens_sha=$2
[[ "$position_lens_stage" =~ ^/tmp/position-lens\.[A-Za-z0-9]+$ ]]
[[ "$position_lens_sha" =~ ^[a-f0-9]{64}$ ]]
printf '%s  %s\n' "$position_lens_sha" "$position_lens_stage/release.tar.gz" | sha256sum -c -

position_lens_device=/dev/xvdf
for attempt in $(seq 1 60); do
  [ -b "$position_lens_device" ] && break
  sleep 2
done
[ -b "$position_lens_device" ] || { echo 'The attached data disk is unavailable.'; exit 1; }
if ! blkid "$position_lens_device" >/dev/null; then
  [ -z "$(wipefs --no-act --noheadings "$position_lens_device")" ] || { echo 'Refusing to format a disk with an existing signature.'; exit 1; }
  mkfs.ext4 -L position-lens-data "$position_lens_device"
fi
[ "$(blkid -s TYPE -o value "$position_lens_device")" = ext4 ]
position_lens_uuid=$(blkid -s UUID -o value "$position_lens_device")
install -d -m 0755 /srv/position-lens-data
if mountpoint -q /srv/position-lens-data; then
  [ "$(findmnt -n -o UUID /srv/position-lens-data)" = "$position_lens_uuid" ]
else
  mount "$position_lens_device" /srv/position-lens-data
fi
grep -q "^UUID=$position_lens_uuid " /etc/fstab || printf 'UUID=%s /srv/position-lens-data ext4 defaults,nofail 0 2\n' "$position_lens_uuid" >> /etc/fstab
install -d -o position-lens -g position-lens -m 0700 /srv/position-lens-data/app
install -d -m 0700 /srv/position-lens-data/backups
install -d -o caddy -g caddy -m 0700 /srv/position-lens-data/caddy

position_lens_release="/opt/position-lens/releases/$position_lens_sha"
install -d -m 0755 "$position_lens_release"
cd "$position_lens_release"
if [ ! -f .installed ]; then
  tar -xzf "$position_lens_stage/release.tar.gz" --no-same-owner -C "$position_lens_release"
  /usr/local/bin/npm ci --omit=dev --no-audit --no-fund
  chmod -R a+rX "$position_lens_release"
  touch .installed
fi
/usr/local/bin/node deploy/lightsail/render-config.mjs "$position_lens_stage/configuration.json"
/usr/local/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
/usr/local/bin/oauth2-proxy --config=/etc/position-lens/oauth2-proxy.cfg --config-test
for unit in position-lens.service position-lens-auth.service caddy.service position-lens-backup.service position-lens-backup.timer; do
  install -m 0644 "deploy/lightsail/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
position_lens_previous=$(readlink -f /opt/position-lens/current || true)
position_lens_was_running=false
systemctl is-active --quiet position-lens.service && position_lens_was_running=true
systemctl stop position-lens.service || true
restore_on_failure() {
  if [ "$position_lens_was_running" = true ] && [ -n "$position_lens_previous" ]; then
    ln -sfn "$position_lens_previous" /opt/position-lens/current
    systemctl restart position-lens.service || true
  fi
}
trap restore_on_failure ERR
if [ -f /srv/position-lens-data/app/position-lens.sqlite ]; then bash deploy/lightsail/backup.sh; fi
runuser -u position-lens -- env DATABASE_PATH=/srv/position-lens-data/app/position-lens.sqlite /usr/local/bin/node deploy/node/migrate.mjs
ln -sfn "$position_lens_release" /opt/position-lens/current
systemctl enable position-lens.service position-lens-auth.service caddy.service position-lens-backup.timer
systemctl restart position-lens.service
position_lens_healthy=false
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/_health >/dev/null; then position_lens_healthy=true; break; fi
  sleep 2
done
[ "$position_lens_healthy" = true ]
systemctl restart position-lens-auth.service
position_lens_auth_ready=false
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4180/ready >/dev/null; then position_lens_auth_ready=true; break; fi
  sleep 2
done
[ "$position_lens_auth_ready" = true ]
systemctl restart caddy.service
systemctl start position-lens-backup.timer
trap - ERR
echo "Installed release $position_lens_sha"
