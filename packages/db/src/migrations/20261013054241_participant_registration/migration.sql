CREATE TABLE `uploaded_file` (
	`id` text PRIMARY KEY,
	`owner_id` text,
	`key` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`state` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_uploaded_file_owner_id_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `user_profile` (
	`user_id` text PRIMARY KEY,
	`draft` text NOT NULL,
	`values` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`dirty` integer DEFAULT true NOT NULL,
	`submitted_at` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_user_profile_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `user` ADD `storage_limit` integer DEFAULT 1073741824 NOT NULL;--> statement-breakpoint
CREATE INDEX `uploaded_file_owner_idx` ON `uploaded_file` (`owner_id`);--> statement-breakpoint
CREATE INDEX `uploaded_file_cleanup_idx` ON `uploaded_file` (`state`,`expires_at`);