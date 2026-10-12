CREATE TABLE `short_link_unlock_attempt` (
	`link_id` text NOT NULL,
	`minute` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `short_link_unlock_attempt_pk` PRIMARY KEY(`link_id`, `minute`),
	CONSTRAINT `fk_short_link_unlock_attempt_link_id_short_link_id_fk` FOREIGN KEY (`link_id`) REFERENCES `short_link`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `short_link` ADD `password_hash` text;