ALTER TABLE `match` ADD `paused_at` integer;--> statement-breakpoint
ALTER TABLE `match` ADD `paused_ms` integer DEFAULT 0 NOT NULL;