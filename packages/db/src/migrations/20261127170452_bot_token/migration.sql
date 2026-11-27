CREATE TABLE `bot_token` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	CONSTRAINT `fk_bot_token_created_by_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `bot_token_created_at_idx` ON `bot_token` (`created_at`);