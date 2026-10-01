ALTER TABLE `short_link` ADD `fallback_url` text;--> statement-breakpoint
ALTER TABLE `short_link` ADD `tags` text DEFAULT '[]' NOT NULL;