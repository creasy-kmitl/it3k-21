-- The calendar becomes one minimal calendar for every department. Every
-- existing item was Tech/Live's, so it moves to Tech/Live. Hand-edited from
-- the generated rebuild: D1 ignores `PRAGMA foreign_keys=OFF` inside its
-- migration transaction, so foreign keys are deferred instead, and the
-- notifications (which point at the rebuilt table) are recreated empty.
DROP TABLE `calendar_action_item`;--> statement-breakpoint
DROP TABLE `calendar_checklist_item`;--> statement-breakpoint
DROP TABLE `calendar_decision`;--> statement-breakpoint
DROP TABLE `calendar_dependency`;--> statement-breakpoint
DROP TABLE `calendar_item_department`;--> statement-breakpoint
DROP TABLE `calendar_notification`;--> statement-breakpoint
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
	`visibility` text DEFAULT 'internal' NOT NULL,
	`approved_at` integer,
	`approved_by_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_calendar_item_department_id_department_id_fk` FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_calendar_item_owner_id_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_calendar_item_approved_by_id_user_id_fk` FOREIGN KEY (`approved_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_calendar_item_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "calendar_item_status_check" CHECK("status" IN ('draft', 'confirmed', 'cancelled')),
	CONSTRAINT "calendar_item_visibility_check" CHECK("visibility" IN ('internal', 'public')),
	CONSTRAINT "calendar_item_time_check" CHECK("end_at" > "start_at")
);
--> statement-breakpoint
-- Old statuses fold into three; only confirmed items stay public. Archived
-- items are dropped: the minimal calendar deletes instead of archiving.
INSERT INTO `__new_calendar_item`(`id`, `department_id`, `title`, `status`, `start_at`, `end_at`, `timezone`, `venue`, `notes`, `owner_id`, `visibility`, `approved_at`, `approved_by_id`, `version`, `created_by_id`, `created_at`, `updated_at`)
SELECT `id`, `tech_live`.`dept_id`, `title`, `new_status`, `start_at`, `end_at`, `timezone`, `venue`, `notes`, `owner_id`,
	CASE WHEN `new_status` = 'confirmed' THEN `visibility` ELSE 'internal' END,
	CASE WHEN `new_status` = 'confirmed' THEN `approved_at` END,
	CASE WHEN `new_status` = 'confirmed' THEN `approved_by_id` END,
	`version`, `created_by_id`, `created_at`, `updated_at`
FROM (
	SELECT *, CASE
		WHEN `status` IN ('draft', 'backlog') THEN 'draft'
		WHEN `status` IN ('cancelled', 'rolled_back') THEN 'cancelled'
		ELSE 'confirmed'
	END AS `new_status`
	FROM `calendar_item`
	WHERE `archived_at` IS NULL
)
INNER JOIN (SELECT `id` AS `dept_id` FROM `department` WHERE `code` = 'tech-live') AS `tech_live`;--> statement-breakpoint
DROP TABLE `calendar_item`;--> statement-breakpoint
ALTER TABLE `__new_calendar_item` RENAME TO `calendar_item`;--> statement-breakpoint
CREATE INDEX `calendar_item_start_at_idx` ON `calendar_item` (`start_at`);--> statement-breakpoint
CREATE INDEX `calendar_item_end_at_idx` ON `calendar_item` (`end_at`);--> statement-breakpoint
CREATE INDEX `calendar_item_owner_id_idx` ON `calendar_item` (`owner_id`);--> statement-breakpoint
CREATE INDEX `calendar_item_department_id_idx` ON `calendar_item` (`department_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `calendar_notification` (
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
	CONSTRAINT "calendar_notification_kind_check" CHECK("kind" IN ('assignment', 'reschedule', 'cancel'))
);
--> statement-breakpoint
CREATE INDEX `calendar_notification_user_id_idx` ON `calendar_notification` (`user_id`,`created_at`);
