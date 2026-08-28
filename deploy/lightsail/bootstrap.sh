#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl tar xz-utils sqlite3 openssl unattended-upgrades
position_lens_tmp=$(mktemp -d)
trap 'rm -rf "$position_lens_tmp"' EXIT
cd "$position_lens_tmp"
curl -fsSL --retry 5 -o node.tar.xz https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz
echo 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6  node.tar.xz' | sha256sum -c -
tar -xJf node.tar.xz -C /opt
ln -sfn /opt/node-v24.21.0-linux-x64/bin/node /usr/local/bin/node
ln -sfn /opt/node-v24.21.0-linux-x64/bin/npm /usr/local/bin/npm
ln -sfn /opt/node-v24.21.0-linux-x64/bin/npx /usr/local/bin/npx
curl -fsSL --retry 5 -o caddy.tar.gz https://github.com/caddyserver/caddy/releases/download/v2.11.4/caddy_2.11.4_linux_amd64.tar.gz
echo '8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9  caddy.tar.gz' | sha512sum -c -
tar -xzf caddy.tar.gz caddy
install -m 0755 caddy /usr/local/bin/caddy
curl -fsSL --retry 5 -o oauth2-proxy.tar.gz https://github.com/oauth2-proxy/oauth2-proxy/releases/download/v7.15.4/oauth2-proxy-v7.15.4.linux-amd64.tar.gz
echo '4fbe902189aab713d9c0519b90a645032d4636ecb523dc36f5cc312d8ebef1e2  oauth2-proxy.tar.gz' | sha256sum -c -
tar -xzf oauth2-proxy.tar.gz
install -m 0755 oauth2-proxy-v7.15.4.linux-amd64/oauth2-proxy /usr/local/bin/oauth2-proxy
for account in position-lens position-lens-auth caddy; do
  id "$account" >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin "$account"
done
install -d -m 0755 /opt/position-lens/releases
install -d -m 0750 /etc/position-lens /etc/caddy
systemctl enable --now unattended-upgrades
