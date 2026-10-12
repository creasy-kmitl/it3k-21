CREATE TABLE `short_link` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`destination` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`expires_at` integer,
	`owner_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_short_link_owner_id_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `short_link_change` (
	`id` text PRIMARY KEY,
	`link_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`impersonated_by` text,
	`action` text NOT NULL,
	`changes` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `short_link_visit_day` (
	`link_id` text NOT NULL,
	`day` text NOT NULL,
	`source` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `short_link_visit_day_pk` PRIMARY KEY(`link_id`, `day`, `source`),
	CONSTRAINT `fk_short_link_visit_day_link_id_short_link_id_fk` FOREIGN KEY (`link_id`) REFERENCES `short_link`(`id`) ON DELETE CASCADE,
	CONSTRAINT "short_link_visit_day_source_check" CHECK("source" IN ('qr', 'link'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `short_link_slug_uidx` ON `short_link` (`slug`);--> statement-breakpoint
CREATE INDEX `short_link_owner_id_idx` ON `short_link` (`owner_id`);--> statement-breakpoint
CREATE INDEX `short_link_updated_at_idx` ON `short_link` (`updated_at`);--> statement-breakpoint
CREATE INDEX `short_link_change_link_id_idx` ON `short_link_change` (`link_id`,`created_at`);