#!/usr/bin/env bash
set -euo pipefail
# Run as root after fetching the approved commit into /opt/wikshi.
cd /opt/wikshi
sudo -u wikshi env PATH="/opt/wikshi-node/bin:$PATH" npm ci --no-audit --no-fund
sudo -u wikshi env PATH="/opt/wikshi-node/bin:$PATH" NEXT_TELEMETRY_DISABLED=1 npm run build
test -s out/index.html
test -s out/docs.html
revision=$(sudo -u wikshi git rev-parse HEAD)
release="/var/www/wikshi/releases/$revision"
install -d -m 755 "$release"
cp -a out/. "$release/"
chmod -R a+rX "$release"
ln -sfn "$release" /var/www/wikshi/current-next
mv -Tf /var/www/wikshi/current-next /var/www/wikshi/current
# Bootstrap once; preserve Certbot's TLS configuration on subsequent deploys.
if [ ! -f /etc/nginx/sites-available/wikshi-web ]; then
  install -m 644 backend/deploy/wikshi-web.nginx /etc/nginx/sites-available/wikshi-web
  ln -s /etc/nginx/sites-available/wikshi-web /etc/nginx/sites-enabled/wikshi-web
fi
nginx -t
systemctl reload nginx
curl --fail --silent -H 'Host: wikshi.xyz' http://127.0.0.1/docs >/dev/null
systemctl is-active wikshi-api
