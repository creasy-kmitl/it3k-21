ALTER TABLE `competition_match_participant` ADD `source_match_id` text REFERENCES competition_match(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `competition_match_participant` ADD `source_result` text;--> statement-breakpoint
CREATE INDEX `competition_participant_source_idx` ON `competition_match_participant` (`source_match_id`);