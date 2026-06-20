CREATE TABLE IF NOT EXISTS `eb_user_profile_ext` (
  `uid` INT UNSIGNED NOT NULL,
  `purchased_model` VARCHAR(120) NOT NULL DEFAULT '',
  `created_at` INT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Shunwei user profile extension';
