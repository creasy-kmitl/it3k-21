CREATE TABLE `email_campaign` (
	`id` text PRIMARY KEY,
	`subject` text NOT NULL,
	`content` text NOT NULL,
	`audience` text NOT NULL,
	`recipient_count` integer NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`sent_by` text,
	`sender_name` text NOT NULL,
	`impersonated_by` text,
	`scope_institution` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_email_campaign_sent_by_user_id_fk` FOREIGN KEY (`sent_by`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `email_campaign_created_at_idx` ON `email_campaign` (`created_at`);--> statement-breakpoint
CREATE INDEX `email_campaign_scope_idx` ON `email_campaign` (`scope_institution`,`created_at`);