# 顺为会员体系 · 数据库迁移脚本

> 库名：`so1988_shunwei`  
> 原则：**仅执行增量 DDL/DML**，禁止用本地测试库整库覆盖生产库。

## 执行顺序

### MVP1（当前可开工）

```bash
mysql -u so1988_shunwei -p so1988_shunwei < mvp1/001_sw_system_config.sql
mysql -u so1988_shunwei -p so1988_shunwei < mvp1/002_sw_integral_batch.sql
mysql -u so1988_shunwei -p so1988_shunwei < mvp1/003_sw_user_membership.sql
mysql -u so1988_shunwei -p so1988_shunwei < mvp1/004_sw_integral_mall.sql
mysql -u so1988_shunwei -p so1988_shunwei < mvp1/005_eb_member_ship_seed.sql
```

### MVP2（审批流，待 MVP1 稳定后）

```bash
mysql -u so1988_shunwei -p so1988_shunwei < mvp2/001_sw_approval.sql
mysql -u so1988_shunwei -p so1988_shunwei < mvp2/002_sw_tier_rules.sql
mysql -u so1988_shunwei -p so1988_shunwei < mvp2/003_sw_store_manager.sql
```

### MVP3（现金券 + 异业商家 + 积分充值）

```bash
mysql -u so1988_shunwei -p so1988_shunwei < mvp3/001_sw_cash_voucher.sql
mysql -u so1988_shunwei -p so1988_shunwei < mvp3/002_sw_merchant.sql
mysql -u so1988_shunwei -p so1988_shunwei < mvp3/003_sw_integral_recharge.sql
```

## 上线前必做

1. `mysqldump` 全量备份生产库
2. 在**预发/维护窗口**按顺序执行对应阶段脚本
3. 执行后验证：`SELECT COUNT(*) FROM sw_system_config;` 等冒烟查询
4. 配置 CRMEB `SHUNWEI_API_URL` 环境变量（会员支付回调）

## 回滚

MVP1 新表可用 `DROP TABLE IF EXISTS sw_*` 回滚（**不影响** CRMEB 核心表）。  
`005_eb_member_ship_seed.sql` 的会员卡配置需手工在 CRMEB 后台恢复。
