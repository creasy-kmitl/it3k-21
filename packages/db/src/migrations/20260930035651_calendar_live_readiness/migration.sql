CREATE TABLE `calendar_checklist_item` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`key` text NOT NULL,
	`checked` integer DEFAULT false NOT NULL,
	`note` text,
	`checked_at` integer,
	`checked_by_id` text,
	CONSTRAINT `fk_calendar_checklist_item_item_id_calendar_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `calendar_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_calendar_checklist_item_checked_by_id_user_id_fk` FOREIGN KEY (`checked_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "calendar_checklist_item_key_check" CHECK("key" IN ('network', 'audio', 'overlay', 'stream', 'scoreboard', 'backup', 'times'))
);
--> statement-breakpoint
ALTER TABLE `calendar_item` ADD `on_call_owner_id` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `calendar_item` ADD `scoreboard_operator_id` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `calendar_item` ADD `mitigation` text;--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_checklist_item_uidx` ON `calendar_checklist_item` (`item_id`,`key`);