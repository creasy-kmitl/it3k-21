ALTER TABLE `athlete` ADD `checkin_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `athlete_checkin_code_uidx` ON `athlete` (`checkin_code`);