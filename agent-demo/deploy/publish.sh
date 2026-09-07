#!/usr/bin/env bash
set -euo pipefail
cd /opt/wikshi/agent-demo
id wikshi-chat >/dev/null 2>&1 || useradd --system --home-dir /var/lib/wikshi-chat --shell /usr/sbin/nologin wikshi-chat
install -d -o wikshi-chat -g wikshi-chat -m 700 /var/lib/wikshi-chat
test -s /etc/wikshi/chat.env
wallet_project_id=$(/opt/wikshi-node/bin/node deploy/public-config.mjs /etc/wikshi/chat-public.env)
sudo -u wikshi env PATH="/opt/wikshi-node/bin:$PATH" npm ci --ignore-scripts --no-audit --no-fund
sudo -u wikshi env PATH="/opt/wikshi-node/bin:$PATH" WIKSHI_CHAT_BASE=/chat/ VITE_WALLETCONNECT_PROJECT_ID="$wallet_project_id" npm run build
sudo -u wikshi env PATH="/opt/wikshi-node/bin:$PATH" npm test
revision=$(sudo -u wikshi git -C /opt/wikshi rev-parse HEAD)
release="/var/www/wikshi-chat/releases/$revision"
install -d -m 755 "$release"
cp -a dist/. "$release/"
chmod -R a+rX "$release"
install -m 644 deploy/wikshi-chat.service /etc/systemd/system/wikshi-chat.service
systemctl daemon-reload
systemctl enable wikshi-chat
systemctl restart wikshi-chat
for attempt in {1..20}; do
    if curl --fail --silent http://127.0.0.1:8081/chat-api/health; then break; fi
    sleep 1
done
curl --fail --silent http://127.0.0.1:8081/chat-api/health
ln -sfn "$release" /var/www/wikshi-chat/current-next
mv -Tf /var/www/wikshi-chat/current-next /var/www/wikshi-chat/current
install -d /etc/nginx/wikshi
install -m 644 deploy/chat-locations.conf /etc/nginx/wikshi/chat-locations.conf
printf '%s\n' 'limit_req_zone $binary_remote_addr zone=wikshi_chat:10m rate=2r/s;' > /etc/nginx/conf.d/wikshi-chat-rate.conf
if ! grep -q 'include /etc/nginx/wikshi/chat-locations.conf;' /etc/nginx/sites-available/wikshi-web; then
    cp -a /etc/nginx/sites-available/wikshi-web /etc/nginx/sites-available/wikshi-web.pre-chat
    sed -i '/root \/var\/www\/wikshi\/current;/a\    include /etc/nginx/wikshi/chat-locations.conf;' /etc/nginx/sites-available/wikshi-web
fi
nginx -t
systemctl reload nginx
systemctl is-active wikshi-chat wikshi-api
