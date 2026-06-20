#!/usr/bin/env bash
# Run all sw_* schema migrations in order (idempotent CREATE TABLE IF NOT EXISTS).
# Usage (Baota / Linux):
#   cd /www/wwwroot/our/shunwei-api
#   chmod +x scripts/run-all-migrations.sh
#   DB_USER=root DB_PASS='your_password' DB_NAME=so1988_shunwei ./scripts/run-all-migrations.sh
#
# Or interactive password prompt:
#   DB_USER=root DB_NAME=so1988_shunwei ./scripts/run-all-migrations.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/migrations"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:-}"
DB_NAME="${DB_NAME:-so1988_shunwei}"
MYSQL_BIN="${MYSQL_BIN:-mysql}"

FILES=(
  "mvp1/001_sw_system_config.sql"
  "mvp1/002_sw_integral_batch.sql"
  "mvp1/003_sw_user_membership.sql"
  "mvp1/004_sw_integral_mall.sql"
  "mvp1/005_eb_member_ship_seed.sql"
  "mvp2/001_sw_approval.sql"
  "mvp2/002_sw_tier_rules.sql"
  "mvp2/003_sw_store_manager.sql"
  "mvp3/001_sw_cash_voucher.sql"
  "mvp3/002_sw_merchant.sql"
  "mvp3/003_sw_integral_recharge.sql"
  "admin-r1/001_sw_admin_audit_log.sql"
  "admin-r2/001_sw_staff_card_and_merchant_extend.sql"
)

mysql_args=(
  --default-character-set=utf8mb4
  -h "$DB_HOST"
  -P "$DB_PORT"
  -u "$DB_USER"
)

if [[ -n "$DB_PASS" ]]; then
  mysql_args+=(-p"$DB_PASS")
fi

echo "=== shunwei-api migrations ==="
echo "Database: $DB_NAME @ $DB_HOST:$DB_PORT"
echo "Root:     $ROOT_DIR"
echo ""

for rel in "${FILES[@]}"; do
  file="$MIGRATIONS_DIR/$rel"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: missing $file" >&2
    exit 1
  fi
  echo ">> Run: $rel"
  "$MYSQL_BIN" "${mysql_args[@]}" "$DB_NAME" < "$file"
done

echo ""
echo "Done. Verify:"
echo "  $MYSQL_BIN ${mysql_args[*]} $DB_NAME -e \"SHOW TABLES LIKE 'sw_%';\""
echo ""
