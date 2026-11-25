ALTER TABLE `match` ADD `announce` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `match` ADD `ranking` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_match` (
	`id` text PRIMARY KEY,
	`sport` text NOT NULL,
	`division` text,
	`round` text,
	`team_a` text,
	`team_b` text,
	`announce` text DEFAULT 'live' NOT NULL,
	`ranking` text,
	`score_a` integer,
	`score_b` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`starts_at` integer,
	`duration_minutes` integer,
	`breaks` text,
	`paused_at` integer,
	`paused_ms` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_match_updated_by_id_user_id_fk` FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__new_match`(`id`, `sport`, `division`, `round`, `team_a`, `team_b`, `score_a`, `score_b`, `status`, `starts_at`, `duration_minutes`, `breaks`, `paused_at`, `paused_ms`, `version`, `updated_by_id`, `created_at`, `updated_at`) SELECT `id`, `sport`, `division`, `round`, `team_a`, `team_b`, `score_a`, `score_b`, `status`, `starts_at`, `duration_minutes`, `breaks`, `paused_at`, `paused_ms`, `version`, `updated_by_id`, `created_at`, `updated_at` FROM `match`;--> statement-breakpoint
DROP TABLE `match`;--> statement-breakpoint
ALTER TABLE `__new_match` RENAME TO `match`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `match_sport_idx` ON `match` (`sport`);--> statement-breakpoint
CREATE INDEX `match_starts_at_idx` ON `match` (`starts_at`);