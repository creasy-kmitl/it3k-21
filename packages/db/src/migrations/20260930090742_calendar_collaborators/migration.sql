-- Departments working on an item alongside its owner, and a notification
-- kind to tell them. Hand-edited: D1 ignores `PRAGMA foreign_keys=OFF` in its
-- migration transaction; nothing references calendar_notification, so the
-- rebuild keeps every row.
CREATE TABLE `calendar_item_collaborator` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`department_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_calendar_item_collaborator_item_id_calendar_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `calendar_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_calendar_item_collaborator_department_id_department_id_fk` FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_calendar_notification` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`item_title` text NOT NULL,
	`data` text NOT NULL,
	`actor_user_id` text,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_calendar_notification_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_calendar_notification_item_id_calendar_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `calendar_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT "calendar_notification_kind_check" CHECK("kind" IN ('assignment', 'collaboration', 'reschedule', 'cancel'))
);
--> statement-breakpoint
INSERT INTO `__new_calendar_notification`(`id`, `user_id`, `item_id`, `kind`, `item_title`, `data`, `actor_user_id`, `read_at`, `created_at`) SELECT `id`, `user_id`, `item_id`, `kind`, `item_title`, `data`, `actor_user_id`, `read_at`, `created_at` FROM `calendar_notification`;--> statement-breakpoint
DROP TABLE `calendar_notification`;--> statement-breakpoint
ALTER TABLE `__new_calendar_notification` RENAME TO `calendar_notification`;--> statement-breakpoint
CREATE INDEX `calendar_notification_user_id_idx` ON `calendar_notification` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_item_collaborator_uidx` ON `calendar_item_collaborator` (`item_id`,`department_id`);--> statement-breakpoint
CREATE INDEX `calendar_item_collaborator_department_id_idx` ON `calendar_item_collaborator` (`department_id`);