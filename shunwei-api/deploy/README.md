# Shunwei API deployment

This service is a sidecar backend for the mini-program. Keep the old CRMEB backend running, then proxy only the new routes to this service.

## 1. Server requirements

- Linux server with Nginx.
- Node.js 20 or 22.
- PM2 installed globally.
- The server can connect to the CRMEB MySQL database.
- A HTTPS domain that can be configured in WeChat mini-program valid domains.

## 2. Upload files

Upload this project to the server, for example:

```bash
/www/wwwroot/shunwei-api
```

Do not upload:

- `node_modules/`
- local `.env`
- local logs

Usually keep `data/newcomer-lottery.json` only when you want to migrate local lottery state.

## 3. Install dependencies

```bash
cd /www/wwwroot/shunwei-api
npm ci --omit=dev
```

## 4. Configure environment

Copy the template:

```bash
cp .env.example .env
```

Edit `.env`:

```text
NODE_ENV=production
PORT=8787
HOST=127.0.0.1
LOG_LEVEL=info
DATA_DIR=./data
PRICE_TAG_DATA_DIR=../digital-price-tag-generator/public/data

ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-password
ADMIN_SESSION_SECRET=replace-with-a-random-string-at-least-24-chars

CRMEB_APP_KEY=replace-with-crmeb-app-key
CRMEB_DB_HOST=127.0.0.1
CRMEB_DB_PORT=3306
CRMEB_DB_USER=replace-with-db-user
CRMEB_DB_PASSWORD=replace-with-db-password
CRMEB_DB_NAME=crmeb
CRMEB_DB_PREFIX=eb_
CRMEB_DB_CHARSET=utf8mb4
```

Production startup will fail if important variables are missing.

## 5. Database table

The service can auto-create the extension table on first use. For a controlled production release, run this manually:

```bash
mysql -u DB_USER -p DB_NAME < deploy/mysql-profile-ext.sql
```

Birthday is stored in the existing CRMEB `eb_user.birthday` field. Purchased model is stored in `eb_user_profile_ext.purchased_model`.

## 6. Start with PM2

```bash
cd /www/wwwroot/shunwei-api
npm run pm2:start
pm2 save
```

Check:

```bash
pm2 status
pm2 logs shunwei-api
curl http://127.0.0.1:8787/health
```

## 7. Nginx

**Production (ok.xjshunwei.cn, same site as CRMEB)** — append to the existing CRMEB `server {}` block:

- `deploy/nginx-ok-xjshunwei-same-site.conf.example` — `/sw-api/` proxy + `/fzlsaas/` SPA alias

**Standalone subdomain** — copy `deploy/nginx-shunwei-api.conf.example` and replace:

- `api.example.com`
- SSL certificate paths

Then test and reload:

```bash
nginx -t
systemctl reload nginx
```

Public check:

```bash
curl https://api.example.com/health
```

## 8. Mini-program

Production mini-program requests must use HTTPS and a WeChat valid domain.

After the API domain is ready, update the mini-program API base URL to:

```text
https://api.example.com
```

Current new routes:

- `GET /health`
- `GET /admin`
- `GET /api/products`
- `GET /api/products/:id`
- `GET /api/admin/products`
- `POST /api/admin/products/import-price-tags`
- `PATCH /api/admin/products/:id/show`
- `PATCH /api/admin/products/batch-show`
- `PUT /api/admin/products/:id`
- `GET /api/newcomer-lottery/state`
- `POST /api/newcomer-lottery/tasks/:taskId/claim`
- `POST /api/newcomer-lottery/draw`
- `GET /api/newcomer-lottery/records`
- `GET /api/user/profile-extra`
- `PUT /api/user/profile-extra`

## 9. Rollback

If the new service has a problem:

```bash
pm2 stop shunwei-api
```

Then remove or disable the Nginx locations that proxy new routes to `127.0.0.1:8787`. The old CRMEB backend can keep running independently.
