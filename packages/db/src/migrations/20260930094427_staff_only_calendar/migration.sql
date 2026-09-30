-- The calendar is for staff only: no public page, so nothing is published.
-- Drops visibility and approval from calendar_item.
--
-- Hand-edited from the generated rebuild. D1 ignores `PRAGMA foreign_keys=OFF`
-- in its migration transaction, and dropping calendar_item would then cascade
-- to its collaborators and notifications, so those rows are set aside first
-- and put back after the rebuild.
CREATE TABLE `__keep_calendar_item_collaborator` AS SELECT * FROM `calendar_item_collaborator`;--> statement-breakpoint
CREATE TABLE `__keep_calendar_notification` AS SELECT * FROM `calendar_notification`;--> statement-breakpoint
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_calendar_item` (
	`id` text PRIMARY KEY,
	`department_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`timezone` text DEFAULT 'Asia/Bangkok' NOT NULL,
	`venue` text,
	`notes` text,
	`owner_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_calendar_item_department_id_department_id_fk` FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_calendar_item_owner_id_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_calendar_item_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "calendar_item_status_check" CHECK("status" IN ('draft', 'confirmed', 'cancelled')),
	CONSTRAINT "calendar_item_time_check" CHECK("end_at" > "start_at")
);
--> statement-breakpoint
INSERT INTO `__new_calendar_item`(`id`, `department_id`, `title`, `status`, `start_at`, `end_at`, `timezone`, `venue`, `notes`, `owner_id`, `version`, `created_by_id`, `created_at`, `updated_at`) SELECT `id`, `department_id`, `title`, `status`, `start_at`, `end_at`, `timezone`, `venue`, `notes`, `owner_id`, `version`, `created_by_id`, `created_at`, `updated_at` FROM `calendar_item`;--> statement-breakpoint
DROP TABLE `calendar_item`;--> statement-breakpoint
ALTER TABLE `__new_calendar_item` RENAME TO `calendar_item`;--> statement-breakpoint
DELETE FROM `calendar_item_collaborator`;--> statement-breakpoint
INSERT INTO `calendar_item_collaborator` (`id`, `item_id`, `department_id`, `created_at`) SELECT `id`, `item_id`, `department_id`, `created_at` FROM `__keep_calendar_item_collaborator`;--> statement-breakpoint
DELETE FROM `calendar_notification`;--> statement-breakpoint
INSERT INTO `calendar_notification` (`id`, `user_id`, `item_id`, `kind`, `item_title`, `data`, `actor_user_id`, `read_at`, `created_at`) SELECT `id`, `user_id`, `item_id`, `kind`, `item_title`, `data`, `actor_user_id`, `read_at`, `created_at` FROM `__keep_calendar_notification`;--> statement-breakpoint
DROP TABLE `__keep_calendar_item_collaborator`;--> statement-breakpoint
DROP TABLE `__keep_calendar_notification`;--> statement-breakpoint
CREATE INDEX `calendar_item_start_at_idx` ON `calendar_item` (`start_at`);--> statement-breakpoint
CREATE INDEX `calendar_item_end_at_idx` ON `calendar_item` (`end_at`);--> statement-breakpoint
CREATE INDEX `calendar_item_owner_id_idx` ON `calendar_item` (`owner_id`);--> statement-breakpoint
CREATE INDEX `calendar_item_department_id_idx` ON `calendar_item` (`department_id`,`start_at`);