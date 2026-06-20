# GitHub Actions 自动部署

本项目已配置 `.github/workflows/deploy.yml`。

推送到 `main` 后，GitHub Actions 会：

1. 安装依赖。
2. 执行 JS 语法检查。
3. 运行 `npm test`。
4. 打包项目代码。
5. 通过 SSH 上传到服务器。
6. 在服务器执行 `npm ci --omit=dev`。
7. 使用 PM2 启动或重载 `shunwei-api`。
8. 请求 `http://127.0.0.1:8787/health` 做健康检查。

## GitHub Secrets

在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 新增：

| Secret | 说明 |
| --- | --- |
| `SERVER_HOST` | 服务器 IP 或域名 |
| `SERVER_PORT` | SSH 端口，默认可填 `22` |
| `SERVER_USER` | SSH 登录用户 |
| `SERVER_SSH_KEY` | SSH 私钥内容 |
| `SERVER_PATH` | 服务器部署目录，例如 `/www/wwwroot/shunwei-api` |

## 服务器准备

服务器需要先安装：

- Node.js 20 或 22
- PM2
- Nginx

首次部署前，服务器上要先准备生产环境变量：

```bash
mkdir -p /www/wwwroot/shunwei-api
cd /www/wwwroot/shunwei-api
cp .env.example .env
```

编辑 `.env`，填入正式的管理员密码、CRMEB 数据库配置、`ADMIN_SESSION_SECRET` 等。

注意：自动部署不会覆盖服务器上的 `.env` 和 `data/`，避免生产密钥和抽奖数据被本地文件覆盖。

## 手动触发

除了 push `main` 自动部署，也可以在 GitHub Actions 页面点击 `Run workflow` 手动触发。
