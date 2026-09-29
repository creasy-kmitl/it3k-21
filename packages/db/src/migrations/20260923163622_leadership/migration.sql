CREATE TABLE `leadership` (
	`id` text PRIMARY KEY,
	`department_id` text NOT NULL,
	`role` text NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`nickname` text,
	`phone` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_leadership_department_id_department_id_fk` FOREIGN KEY (`department_id`) REFERENCES `department`(`id`),
	CONSTRAINT `fk_leadership_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "leadership_role_check" CHECK("role" IN ('head', 'vicehead'))
);
--> statement-breakpoint
CREATE TABLE `leadership_social` (
	`id` text PRIMARY KEY,
	`leadership_id` text NOT NULL,
	`platform` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `fk_leadership_social_leadership_id_leadership_id_fk` FOREIGN KEY (`leadership_id`) REFERENCES `leadership`(`id`) ON DELETE CASCADE,
	CONSTRAINT "leadership_social_platform_check" CHECK("platform" IN ('facebook', 'instagram', 'line', 'discord', 'other'))
);
--> statement-breakpoint
ALTER TABLE `department` ADD `code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `department_code_uidx` ON `department` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `leadership_seat_uidx` ON `leadership` (`department_id`,`role`);--> statement-breakpoint
CREATE UNIQUE INDEX `leadership_user_uidx` ON `leadership` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `leadership_social_platform_uidx` ON `leadership_social` (`leadership_id`,`platform`);--> statement-breakpoint
-- Backfill codes for the seeded departments that manage the leadership roster.
-- Renamed or custom departments are assigned a code by an admin instead.
UPDATE `department` SET `code` = 'tech-live' WHERE `name` = 'Tech/Live';--> statement-breakpoint
UPDATE `department` SET `code` = 'registration' WHERE `name` = 'ทะเบียน';
