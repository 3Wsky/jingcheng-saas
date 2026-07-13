-- Reset all existing integral products to unlimited per-user exchanges.
UPDATE `eb_store_integral`
SET `num` = 0, `exchange_limit_started_at` = 0
WHERE `is_del` = 0;
