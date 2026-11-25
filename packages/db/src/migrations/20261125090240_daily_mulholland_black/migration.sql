ALTER TABLE `match` ADD `scoring` text DEFAULT 'points' NOT NULL;--> statement-breakpoint
ALTER TABLE `match` ADD `sets_to_win` integer;--> statement-breakpoint
ALTER TABLE `match` ADD `sets` text;--> statement-breakpoint
ALTER TABLE `match` ADD `winner` text;