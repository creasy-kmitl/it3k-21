CREATE TABLE `event_ticket` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`code` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_event_ticket_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_event_ticket_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `event` ADD `tickets_open` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `event` ADD `ticket_capacity` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `event_ticket_code_uidx` ON `event_ticket` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_ticket_event_user_uidx` ON `event_ticket` (`event_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `event_ticket_user_id_idx` ON `event_ticket` (`user_id`);