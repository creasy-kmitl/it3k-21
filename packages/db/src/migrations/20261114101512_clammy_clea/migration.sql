CREATE TABLE `event` (
	`id` text PRIMARY KEY,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`venue_id` text,
	`thumbnail_url` text,
	`created_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_event_venue_id_venue_id_fk` FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`),
	CONSTRAINT `fk_event_created_by_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "event_type_check" CHECK("type" IN ('sport', 'general')),
	CONSTRAINT "event_time_check" CHECK("end_at" > "start_at")
);
--> statement-breakpoint
CREATE TABLE `event_division` (
	`event_id` text NOT NULL,
	`division_id` text NOT NULL,
	CONSTRAINT `event_division_pk` PRIMARY KEY(`event_id`, `division_id`),
	CONSTRAINT `fk_event_division_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_division_division_id_sport_division_id_fk` FOREIGN KEY (`division_id`) REFERENCES `sport_division`(`id`)
);
--> statement-breakpoint
CREATE TABLE `event_institution` (
	`event_id` text NOT NULL,
	`institution` text NOT NULL,
	CONSTRAINT `event_institution_pk` PRIMARY KEY(`event_id`, `institution`),
	CONSTRAINT `fk_event_institution_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `venue` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`description` text,
	`latitude` real,
	`longitude` real,
	`external_url` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "venue_position_check" CHECK(("latitude" IS NULL) = ("longitude" IS NULL) AND ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90) AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180))
);
--> statement-breakpoint
CREATE INDEX `event_start_at_idx` ON `event` (`start_at`);--> statement-breakpoint
CREATE INDEX `event_venue_id_idx` ON `event` (`venue_id`);--> statement-breakpoint
CREATE INDEX `event_division_division_id_idx` ON `event_division` (`division_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `venue_name_uidx` ON `venue` (`name`);