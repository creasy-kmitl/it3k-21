CREATE TABLE `sport_rule` (
	`id` text PRIMARY KEY,
	`sport_id` text,
	`division_id` text,
	`markdown` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_sport_rule_sport_id_sport_id_fk` FOREIGN KEY (`sport_id`) REFERENCES `sport`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sport_rule_division_id_sport_division_id_fk` FOREIGN KEY (`division_id`) REFERENCES `sport_division`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sport_rule_updated_by_user_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "sport_rule_owner_check" CHECK(("sport_id" IS NULL) <> ("division_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sport_rule_sport_uidx` ON `sport_rule` (`sport_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sport_rule_division_uidx` ON `sport_rule` (`division_id`);