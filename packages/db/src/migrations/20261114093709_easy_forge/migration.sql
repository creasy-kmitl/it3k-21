CREATE TABLE `sport` (
	`id` text PRIMARY KEY,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon` text DEFAULT 'general' NOT NULL,
	`thumbnail_url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "sport_icon_check" CHECK("icon" IN ('football', 'athletics', 'basketball', 'table-tennis', 'chairball', 'badminton', 'petanque', 'folk', 'esports', 'general'))
);
--> statement-breakpoint
CREATE TABLE `sport_division` (
	`id` text PRIMARY KEY,
	`sport_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`gender` text NOT NULL,
	`format` text NOT NULL,
	`requires_shirt_number` integer DEFAULT false NOT NULL,
	`requires_badminton_rank` integer DEFAULT false NOT NULL,
	`requires_game_profile` integer DEFAULT false NOT NULL,
	`max_per_institution` integer,
	`registration_open` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_sport_division_sport_id_sport_id_fk` FOREIGN KEY (`sport_id`) REFERENCES `sport`(`id`),
	CONSTRAINT "sport_division_gender_check" CHECK("gender" IN ('male', 'female', 'mixed', 'open')),
	CONSTRAINT "sport_division_format_check" CHECK("format" IN ('individual', 'pair', 'team')),
	CONSTRAINT "sport_division_max_check" CHECK("max_per_institution" IS NULL OR "max_per_institution" > 0)
);
--> statement-breakpoint
ALTER TABLE `user` ADD `institution` text;--> statement-breakpoint
CREATE UNIQUE INDEX `sport_code_uidx` ON `sport` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `sport_division_code_uidx` ON `sport_division` (`code`);--> statement-breakpoint
CREATE INDEX `sport_division_sport_id_idx` ON `sport_division` (`sport_id`);