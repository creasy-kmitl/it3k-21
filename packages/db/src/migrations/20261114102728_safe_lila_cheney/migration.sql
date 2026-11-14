CREATE TABLE `event_checkin` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`checked_in_by` text,
	`method` text NOT NULL,
	`forced` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_event_checkin_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_checkin_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_checkin_checked_in_by_user_id_fk` FOREIGN KEY (`checked_in_by`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "event_checkin_method_check" CHECK("method" IN ('scan', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_checkin_event_user_uidx` ON `event_checkin` (`event_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `event_checkin_user_id_idx` ON `event_checkin` (`user_id`);