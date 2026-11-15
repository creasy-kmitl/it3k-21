CREATE TABLE `match` (
	`id` text PRIMARY KEY,
	`sport` text NOT NULL,
	`round` text,
	`team_a` text NOT NULL,
	`team_b` text NOT NULL,
	`score_a` integer,
	`score_b` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`starts_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_match_updated_by_id_user_id_fk` FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `match_sport_idx` ON `match` (`sport`);--> statement-breakpoint
CREATE INDEX `match_starts_at_idx` ON `match` (`starts_at`);