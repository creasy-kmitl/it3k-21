CREATE TABLE `competition_change` (
	`id` text PRIMARY KEY,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`actor_user_id` text,
	`impersonated_by` text,
	`action` text NOT NULL,
	`changes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `competition_group` (
	`id` text PRIMARY KEY,
	`division_id` text NOT NULL,
	`stage_name` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_competition_group_division_id_sport_division_id_fk` FOREIGN KEY (`division_id`) REFERENCES `sport_division`(`id`)
);
--> statement-breakpoint
CREATE TABLE `competition_group_team` (
	`group_id` text NOT NULL,
	`team_id` text NOT NULL,
	`seed` integer,
	CONSTRAINT `competition_group_team_pk` PRIMARY KEY(`group_id`, `team_id`),
	CONSTRAINT `fk_competition_group_team_group_id_competition_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `competition_group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_competition_group_team_team_id_competition_team_id_fk` FOREIGN KEY (`team_id`) REFERENCES `competition_team`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `competition_lineup` (
	`participant_id` text NOT NULL,
	`match_id` text NOT NULL,
	`registration_id` text NOT NULL,
	`role` text NOT NULL,
	CONSTRAINT `competition_lineup_pk` PRIMARY KEY(`participant_id`, `registration_id`),
	CONSTRAINT `fk_competition_lineup_participant_id_competition_match_participant_id_fk` FOREIGN KEY (`participant_id`) REFERENCES `competition_match_participant`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_competition_lineup_match_id_competition_match_id_fk` FOREIGN KEY (`match_id`) REFERENCES `competition_match`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_competition_lineup_registration_id_sport_registration_id_fk` FOREIGN KEY (`registration_id`) REFERENCES `sport_registration`(`id`) ON DELETE CASCADE,
	CONSTRAINT "competition_lineup_role_check" CHECK("role" IN ('starter', 'sub'))
);
--> statement-breakpoint
CREATE TABLE `competition_match` (
	`id` text PRIMARY KEY,
	`division_id` text NOT NULL,
	`parent_match_id` text,
	`sub_order` integer,
	`group_id` text,
	`stage_name` text NOT NULL,
	`round_no` integer,
	`match_no` integer,
	`start_at` integer,
	`venue_id` text,
	`court` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`outcome` text,
	`friendly` integer DEFAULT false NOT NULL,
	`scoring_config` text,
	`live_state` text,
	`score_seq` integer DEFAULT 0 NOT NULL,
	`cover_image_url` text,
	`notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_competition_match_division_id_sport_division_id_fk` FOREIGN KEY (`division_id`) REFERENCES `sport_division`(`id`),
	CONSTRAINT `fk_competition_match_parent_match_id_competition_match_id_fk` FOREIGN KEY (`parent_match_id`) REFERENCES `competition_match`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_competition_match_group_id_competition_group_id_fk` FOREIGN KEY (`group_id`) REFERENCES `competition_group`(`id`),
	CONSTRAINT `fk_competition_match_venue_id_venue_id_fk` FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_competition_match_created_by_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "competition_match_sub_check" CHECK(("parent_match_id" IS NULL) = ("sub_order" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `competition_match_checkin` (
	`id` text PRIMARY KEY,
	`match_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`method` text NOT NULL,
	`checked_in_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_competition_match_checkin_match_id_competition_match_id_fk` FOREIGN KEY (`match_id`) REFERENCES `competition_match`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_competition_match_checkin_participant_id_competition_match_participant_id_fk` FOREIGN KEY (`participant_id`) REFERENCES `competition_match_participant`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_competition_match_checkin_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_competition_match_checkin_checked_in_by_user_id_fk` FOREIGN KEY (`checked_in_by`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "competition_checkin_method_check" CHECK("method" IN ('scan', 'manual'))
);
--> statement-breakpoint
CREATE TABLE `competition_match_image` (
	`id` text PRIMARY KEY,
	`match_id` text NOT NULL,
	`url` text NOT NULL,
	`caption` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_cover` integer DEFAULT false NOT NULL,
	`uploaded_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_competition_match_image_match_id_competition_match_id_fk` FOREIGN KEY (`match_id`) REFERENCES `competition_match`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_competition_match_image_uploaded_by_user_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `competition_match_participant` (
	`id` text PRIMARY KEY,
	`match_id` text NOT NULL,
	`team_id` text,
	`label` text,
	`slot` integer NOT NULL,
	`score` integer,
	`detail` text,
	`result_value` integer,
	`rank` integer,
	`outcome` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_competition_match_participant_match_id_competition_match_id_fk` FOREIGN KEY (`match_id`) REFERENCES `competition_match`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_competition_match_participant_team_id_competition_team_id_fk` FOREIGN KEY (`team_id`) REFERENCES `competition_team`(`id`),
	CONSTRAINT "competition_participant_side_check" CHECK("team_id" IS NOT NULL OR "label" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `competition_match_referee` (
	`id` text PRIMARY KEY,
	`match_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_competition_match_referee_match_id_competition_match_id_fk` FOREIGN KEY (`match_id`) REFERENCES `competition_match`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `competition_placement` (
	`team_id` text PRIMARY KEY,
	`division_id` text NOT NULL,
	`place` integer NOT NULL,
	`updated_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_competition_placement_team_id_competition_team_id_fk` FOREIGN KEY (`team_id`) REFERENCES `competition_team`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_competition_placement_division_id_sport_division_id_fk` FOREIGN KEY (`division_id`) REFERENCES `sport_division`(`id`),
	CONSTRAINT `fk_competition_placement_updated_by_user_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "competition_placement_place_check" CHECK("place" >= 1)
);
--> statement-breakpoint
CREATE TABLE `competition_score_event` (
	`id` text PRIMARY KEY,
	`match_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`participant_id` text,
	`registration_id` text,
	`payload` text NOT NULL,
	`voided_at` integer,
	`voided_by` text,
	`created_by` text,
	`client_created_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_competition_score_event_match_id_competition_match_id_fk` FOREIGN KEY (`match_id`) REFERENCES `competition_match`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_competition_score_event_participant_id_competition_match_participant_id_fk` FOREIGN KEY (`participant_id`) REFERENCES `competition_match_participant`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_competition_score_event_voided_by_user_id_fk` FOREIGN KEY (`voided_by`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_competition_score_event_created_by_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `competition_team` (
	`id` text PRIMARY KEY,
	`division_id` text NOT NULL,
	`institution` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`name` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_competition_team_division_id_sport_division_id_fk` FOREIGN KEY (`division_id`) REFERENCES `sport_division`(`id`),
	CONSTRAINT "competition_team_seq_check" CHECK("seq" >= 1)
);
--> statement-breakpoint
CREATE TABLE `competition_team_member` (
	`team_id` text NOT NULL,
	`registration_id` text NOT NULL,
	`user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `competition_team_member_pk` PRIMARY KEY(`team_id`, `registration_id`),
	CONSTRAINT `fk_competition_team_member_team_id_competition_team_id_fk` FOREIGN KEY (`team_id`) REFERENCES `competition_team`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_competition_team_member_registration_id_sport_registration_id_fk` FOREIGN KEY (`registration_id`) REFERENCES `sport_registration`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_competition_team_member_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `competition_team_official` (
	`id` text PRIMARY KEY,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`position` text,
	`description` text,
	`photo_url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_competition_team_official_team_id_competition_team_id_fk` FOREIGN KEY (`team_id`) REFERENCES `competition_team`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `sport_division` ADD `max_teams_per_institution` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `sport_division` ADD `team_min_size` integer;--> statement-breakpoint
ALTER TABLE `sport_division` ADD `team_max_size` integer;--> statement-breakpoint
ALTER TABLE `sport_division` ADD `gender_minimums` text;--> statement-breakpoint
ALTER TABLE `sport_division` ADD `max_officials` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `sport_division` ADD `lineup_starters` integer;--> statement-breakpoint
ALTER TABLE `sport_division` ADD `lineup_max_subs` integer;--> statement-breakpoint
ALTER TABLE `sport_division` ADD `scoring_config` text;--> statement-breakpoint
ALTER TABLE `sport_division` ADD `standings_config` text;--> statement-breakpoint
ALTER TABLE `sport_division` ADD `checkin_mode` text DEFAULT 'kiosk' NOT NULL;--> statement-breakpoint
ALTER TABLE `sport_division` ADD `checkin_opens_min` integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE `sport_division` ADD `checkin_closes_min` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `sport_division` ADD `checkin_min_players` integer;--> statement-breakpoint
ALTER TABLE `sport_division` ADD `awards_medals` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `sport_division` ADD `competition_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `competition_change_entity_idx` ON `competition_change` (`entity`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `competition_group_name_uidx` ON `competition_group` (`division_id`,`stage_name`,`name`);--> statement-breakpoint
CREATE INDEX `competition_group_team_team_idx` ON `competition_group_team` (`team_id`);--> statement-breakpoint
CREATE INDEX `competition_lineup_match_idx` ON `competition_lineup` (`match_id`);--> statement-breakpoint
CREATE INDEX `competition_match_division_start_idx` ON `competition_match` (`division_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `competition_match_status_start_idx` ON `competition_match` (`status`,`start_at`);--> statement-breakpoint
CREATE INDEX `competition_match_venue_start_idx` ON `competition_match` (`venue_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `competition_match_group_idx` ON `competition_match` (`group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `competition_match_sub_uidx` ON `competition_match` (`parent_match_id`,`sub_order`) WHERE "competition_match"."parent_match_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `competition_checkin_user_uidx` ON `competition_match_checkin` (`match_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `competition_checkin_participant_idx` ON `competition_match_checkin` (`participant_id`);--> statement-breakpoint
CREATE INDEX `competition_image_match_idx` ON `competition_match_image` (`match_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `competition_image_cover_uidx` ON `competition_match_image` (`match_id`) WHERE "competition_match_image"."is_cover" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `competition_participant_slot_uidx` ON `competition_match_participant` (`match_id`,`slot`);--> statement-breakpoint
CREATE UNIQUE INDEX `competition_participant_team_uidx` ON `competition_match_participant` (`match_id`,`team_id`) WHERE "competition_match_participant"."team_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `competition_participant_team_idx` ON `competition_match_participant` (`team_id`);--> statement-breakpoint
CREATE INDEX `competition_referee_match_idx` ON `competition_match_referee` (`match_id`);--> statement-breakpoint
CREATE INDEX `competition_placement_division_idx` ON `competition_placement` (`division_id`,`place`);--> statement-breakpoint
CREATE UNIQUE INDEX `competition_score_event_seq_uidx` ON `competition_score_event` (`match_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `competition_team_slot_uidx` ON `competition_team` (`division_id`,`institution`,`seq`);--> statement-breakpoint
CREATE INDEX `competition_team_institution_idx` ON `competition_team` (`institution`);--> statement-breakpoint
CREATE UNIQUE INDEX `competition_team_member_registration_uidx` ON `competition_team_member` (`registration_id`);--> statement-breakpoint
CREATE INDEX `competition_team_member_user_idx` ON `competition_team_member` (`user_id`);--> statement-breakpoint
CREATE INDEX `competition_team_official_team_idx` ON `competition_team_official` (`team_id`);