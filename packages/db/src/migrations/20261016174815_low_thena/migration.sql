ALTER TABLE `uploaded_file` ADD `request_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uploaded_file_request_idx` ON `uploaded_file` (`owner_id`,`request_id`);