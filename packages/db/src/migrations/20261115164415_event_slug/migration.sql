ALTER TABLE `event` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `event_slug_uidx` ON `event` (`slug`);