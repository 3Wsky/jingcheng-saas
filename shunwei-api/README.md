# 顺为小程序新后端

这是顺为小程序的新后端旁路服务，目标是先承接新功能，再逐步替换旧 CRMEB 后端。

当前阶段不替换旧 CRMEB 的登录、订单、支付和物流，只接管：

- 新客抽奖接口
- 抽奖运营后台
- 用户资料扩展字段：生日、购买机型
- 展示型商品管理：商品、SKU、官网参数、一键导入上架

## 抽奖规则能力

运营后台当前可以配置：

- 奖品名称、标签、库存
- 奖品权重，后台会按权重展示当前估算中奖率
- 活动每日抽奖上限
- 连续未中 N 次后的保底奖品
- 某个奖品是否限制同一用户只能中一次
- 全局只发一次的奖品可以把库存设为 `1`

保底规则优先于普通权重随机。若保底奖品已禁用、无库存，或用户已经中过且该奖品配置为单用户限中一次，则自动回退到普通权重随机。

## 本地启动

```bash
npm install
npm run dev
```

默认地址：

```text
http://127.0.0.1:8787
```

健康检查：

```bash
npm run health
```

后台页面：

```text
http://127.0.0.1:8787/admin
```

## 生产部署

部署说明见：

```text
deploy/README.md
```

核心方式是：

1. 旧 CRMEB 后端继续运行。
2. 新后端用 PM2 跑在服务器 `127.0.0.1:8787`。
3. Nginx 只把 `/admin` 和新接口反代到新后端。
4. 小程序生产环境使用 HTTPS 合法域名访问。

## 当前接口

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

## 商品管理

商品管理先做展示型商品库，不迁移 CRMEB 的购物车、订单、快递、发货、售后等交易能力。

后台“一键导入并上架”会读取 `digital-price-tag-generator` 生成的官网爬虫数据：

```text
../digital-price-tag-generator/public/data/products.json
../digital-price-tag-generator/public/data/dji-products.json
```

可用环境变量覆盖路径：

```text
PRICE_TAG_DATA_DIR=/www/wwwroot/digital-price-tag-generator/public/data
```

导入后的商品保留 CRMEB 常用展示字段概念：

- `storeName`、`storeInfo`、`keyword`
- `price`、`otPrice`、`unitName`
- `skuPrices` / `attrs`
- `paramsList`
- `isShow`、`isHot`、`isBest`、`isNew`、`sort`

## 与 CRMEB 的关系

- 小程序前端：`D:\shunwei`
- 旧 CRMEB 后端：`D:\CMB\crmeb`
- 新后端：`D:\CMB\shunwei-api`

新后端会读取小程序请求头里的 CRMEB token：

- `Authori-zation`
- `Authorization`

并使用 `CRMEB_APP_KEY` 校验 HS256 JWT，从 payload 的 `jti.id` 取得 CRMEB 用户 `uid`。

## 用户资料存储

- 生日：写入旧库 `eb_user.birthday`
- 购买机型：写入扩展表 `eb_user_profile_ext.purchased_model`

扩展表 SQL：

```text
deploy/mysql-profile-ext.sql
```

服务启动后如果接口首次访问，也会尝试自动创建扩展表。生产环境建议手动先执行 SQL，方便控制权限和上线节奏。
