CREATE TABLE `leadership_contact_reveal` (
	`id` text PRIMARY KEY,
	`actor_user_id` text NOT NULL,
	`actor_department_code` text,
	`impersonated_by` text,
	`leadership_id` text NOT NULL,
	`department_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `leadership_contact_reveal_actor_idx` ON `leadership_contact_reveal` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `leadership_contact_reveal_seat_idx` ON `leadership_contact_reveal` (`leadership_id`,`created_at`);