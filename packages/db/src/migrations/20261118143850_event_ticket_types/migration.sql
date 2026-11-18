CREATE TABLE `event_ticket_type` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`capacity` integer,
	`max_per_user` integer DEFAULT 1 NOT NULL,
	`open` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`listed_only` integer DEFAULT false NOT NULL,
	`allowed_roles` text DEFAULT '[]' NOT NULL,
	`allowed_institutions` text DEFAULT '[]' NOT NULL,
	`allowed_sport_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_event_ticket_type_event_id_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `event` ADD `content` text;--> statement-breakpoint
ALTER TABLE `event_checkin` ADD `ticket_id` text REFERENCES event_ticket(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `event_ticket` ADD `ticket_type_id` text REFERENCES event_ticket_type(id);--> statement-breakpoint
DROP INDEX IF EXISTS `event_checkin_event_user_uidx`;--> statement-breakpoint
DROP INDEX IF EXISTS `event_ticket_event_user_uidx`;--> statement-breakpoint
CREATE UNIQUE INDEX `event_checkin_ticket_uidx` ON `event_checkin` (`ticket_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_checkin_ticketless_uidx` ON `event_checkin` (`event_id`,`user_id`) WHERE "event_checkin"."ticket_id" IS NULL;--> statement-breakpoint
CREATE INDEX `event_checkin_event_user_idx` ON `event_checkin` (`event_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `event_ticket_event_user_idx` ON `event_ticket` (`event_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `event_ticket_type_user_idx` ON `event_ticket` (`ticket_type_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `event_ticket_type_event_id_idx` ON `event_ticket_type` (`event_id`);