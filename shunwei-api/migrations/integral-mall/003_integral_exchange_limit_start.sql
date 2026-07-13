-- Apply the per-user exchange limit only to orders created after this migration.
ALTER TABLE `eb_store_integral`
  ADD COLUMN `exchange_limit_started_at` int(10) unsigned NOT NULL DEFAULT '0' COMMENT 'exchange limit effective time' AFTER `num`;

UPDATE `eb_store_integral`
SET `exchange_limit_started_at` = UNIX_TIMESTAMP()
WHERE `exchange_limit_started_at` = 0 AND `num` > 0;
