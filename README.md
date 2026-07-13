# jingcheng-saas · 锦程会员 SaaS（Monorepo）

> Admin + shunwei-api 单体仓库，push `main` 自动部署至 `ok.xjshunwei.cn`

阶段开发记录见 [DEVELOPMENT_LOG.md](./DEVELOPMENT_LOG.md)。

## 仓库结构

```
jingcheng-saas/
├── fzlsaas-admin/          Vue3 运营后台 → /fzlsaas/
├── shunwei-api/            Node 旁路 API → /sw-api/
├── .github/workflows/      GitHub Actions 自动部署
└── scripts/                从 shunwei-membership 同步脚本
```

## 生产地址

| 组件 | URL |
|------|-----|
| Admin | https://ok.xjshunwei.cn/fzlsaas/ |
| API | https://ok.xjshunwei.cn/sw-api/health |

## 本地开发

```bash
# Admin
cd fzlsaas-admin && npm ci && npm run dev

# API
cd shunwei-api && npm ci && cp .env.example .env && npm run dev
```

## 自动部署

`push main` 触发两个并行 Job：

1. **deploy-admin** — `npm run build` → SCP `dist/` → `/www/wwwroot/our/fzlsaas-admin/dist/`
2. **deploy-api** — 打包源码 → SCP → PM2 reload → `/www/wwwroot/our/shunwei-api/`
3. **verify** — curl health + fzlsaas

### GitHub Secrets

| Secret | 示例 |
|--------|------|
| `SERVER_HOST` | 服务器 IP |
| `SERVER_PORT` | `22` |
| `SERVER_USER` | `root` |
| `SERVER_SSH_KEY` | deploy 私钥 |
| `ADMIN_DEPLOY_PATH` | `/www/wwwroot/our/fzlsaas-admin/dist` |
| `API_DEPLOY_PATH` | `/www/wwwroot/our/shunwei-api` |

> **首次 API 部署前**：服务器 `API_DEPLOY_PATH/.env` 必须已存在（含 CRMEB_APP_KEY 等），CI 不会覆盖 `.env`。

### 创建 GitHub 仓库

```bash
# 1. GitHub 网页创建空仓库 jingcheng-saas
# 2. 配置 Secrets（上表）
# 3. 首次推送
cd jingcheng-saas
git init && git add . && git commit -m "chore: init jingcheng-saas monorepo"
git branch -M main
git remote add origin https://github.com/3Wsky/jingcheng-saas.git
git push -u origin main
```

## 从 shunwei-membership 同步

```powershell
.\jingcheng-saas\scripts\sync-from-monorepo.ps1
```

## 日常流程

1. 改 `fzlsaas-admin/` 或 `shunwei-api/` 代码
2. `git push origin main`
3. GitHub Actions 自动部署（约 3–5 分钟）
4. 验证生产 URL
