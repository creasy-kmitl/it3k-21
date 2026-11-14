CREATE TABLE `athlete` (
	`user_id` text PRIMARY KEY,
	`student_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_athlete_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sport_registration` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`division_id` text NOT NULL,
	`institution` text NOT NULL,
	`status` text DEFAULT 'review' NOT NULL,
	`shirt_number` integer,
	`badminton_rank` integer,
	`ign` text DEFAULT '' NOT NULL,
	`ign_reading` text DEFAULT '' NOT NULL,
	`facebook_url` text DEFAULT '' NOT NULL,
	`discord_user_id` text,
	`discord_username` text,
	`review_note` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_sport_registration_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sport_registration_division_id_sport_division_id_fk` FOREIGN KEY (`division_id`) REFERENCES `sport_division`(`id`),
	CONSTRAINT `fk_sport_registration_reviewed_by_user_id_fk` FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "sport_registration_status_check" CHECK("status" IN ('review', 'approved', 'rejected')),
	CONSTRAINT "sport_registration_rank_check" CHECK("badminton_rank" IS NULL OR "badminton_rank" IN (1, 2)),
	CONSTRAINT "sport_registration_shirt_check" CHECK("shirt_number" IS NULL OR "shirt_number" BETWEEN 0 AND 99)
);
--> statement-breakpoint
CREATE TABLE `sport_registration_change` (
	`id` text PRIMARY KEY,
	`registration_id` text NOT NULL,
	`athlete_user_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`impersonated_by` text,
	`action` text NOT NULL,
	`changes` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sport_registration_user_division_uidx` ON `sport_registration` (`user_id`,`division_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sport_registration_shirt_uidx` ON `sport_registration` (`division_id`,`institution`,`shirt_number`) WHERE shirt_number IS NOT NULL AND status <> 'rejected';--> statement-breakpoint
CREATE UNIQUE INDEX `sport_registration_rank_uidx` ON `sport_registration` (`division_id`,`institution`,`badminton_rank`) WHERE badminton_rank IS NOT NULL AND status <> 'rejected';--> statement-breakpoint
CREATE INDEX `sport_registration_division_idx` ON `sport_registration` (`division_id`,`institution`);--> statement-breakpoint
CREATE INDEX `sport_registration_institution_idx` ON `sport_registration` (`institution`,`status`);--> statement-breakpoint
CREATE INDEX `sport_registration_change_registration_idx` ON `sport_registration_change` (`registration_id`,`created_at`);