CREATE TABLE `calendar_action_item` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`title` text NOT NULL,
	`owner_id` text,
	`department_id` text,
	`due_at` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`done_at` integer,
	`done_by_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_calendar_action_item_item_id_calendar_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `calendar_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_calendar_action_item_owner_id_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_calendar_action_item_department_id_department_id_fk` FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_calendar_action_item_done_by_id_user_id_fk` FOREIGN KEY (`done_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_calendar_action_item_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "calendar_action_item_status_check" CHECK("status" IN ('open', 'done'))
);
--> statement-breakpoint
CREATE TABLE `calendar_change` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`impersonated_by` text,
	`action` text NOT NULL,
	`changes` text NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_checklist_item` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`key` text NOT NULL,
	`checked` integer DEFAULT false NOT NULL,
	`note` text,
	`checked_at` integer,
	`checked_by_id` text,
	CONSTRAINT `fk_calendar_checklist_item_item_id_calendar_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `calendar_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_calendar_checklist_item_checked_by_id_user_id_fk` FOREIGN KEY (`checked_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "calendar_checklist_item_key_check" CHECK("key" IN ('network', 'audio', 'overlay', 'stream', 'scoreboard', 'backup', 'times'))
);
--> statement-breakpoint
CREATE TABLE `calendar_decision` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`text` text NOT NULL,
	`created_by_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_calendar_decision_item_id_calendar_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `calendar_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_calendar_decision_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_dependency` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`depends_on_id` text NOT NULL,
	`impact` text,
	`created_by_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_calendar_dependency_item_id_calendar_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `calendar_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_calendar_dependency_depends_on_id_calendar_item_id_fk` FOREIGN KEY (`depends_on_id`) REFERENCES `calendar_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_calendar_dependency_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "calendar_dependency_self_check" CHECK("item_id" <> "depends_on_id")
);
--> statement-breakpoint
CREATE TABLE `calendar_item` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`mode` text NOT NULL,
	`category` text NOT NULL,
	`status` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`timezone` text DEFAULT 'Asia/Bangkok' NOT NULL,
	`owner_id` text,
	`source` text NOT NULL,
	`last_confirmed_at` integer,
	`last_confirmed_by_id` text,
	`visibility` text DEFAULT 'internal' NOT NULL,
	`approved_at` integer,
	`approved_by_id` text,
	`risk_level` text,
	`blocked_reason` text,
	`notes` text,
	`game` text,
	`match_id` text,
	`teams` text,
	`venue` text,
	`stream_platform` text,
	`scoreboard_url` text,
	`on_call_owner_id` text,
	`scoreboard_operator_id` text,
	`mitigation` text,
	`spec_url` text,
	`design_url` text,
	`pull_request_url` text,
	`qa_url` text,
	`incident_url` text,
	`qa_result` text,
	`rollout_plan` text,
	`rollback_plan` text,
	`monitoring_owner_id` text,
	`release_approved_at` integer,
	`release_approved_by_id` text,
	`meeting_link` text,
	`agenda` text,
	`feature` text,
	`environment` text,
	`archived_at` integer,
	`series_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_calendar_item_owner_id_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_calendar_item_last_confirmed_by_id_user_id_fk` FOREIGN KEY (`last_confirmed_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_calendar_item_approved_by_id_user_id_fk` FOREIGN KEY (`approved_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_calendar_item_on_call_owner_id_user_id_fk` FOREIGN KEY (`on_call_owner_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_calendar_item_scoreboard_operator_id_user_id_fk` FOREIGN KEY (`scoreboard_operator_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_calendar_item_monitoring_owner_id_user_id_fk` FOREIGN KEY (`monitoring_owner_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_calendar_item_release_approved_by_id_user_id_fk` FOREIGN KEY (`release_approved_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_calendar_item_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "calendar_item_mode_check" CHECK("mode" IN ('operations', 'coordination', 'delivery', 'meetings')),
	CONSTRAINT "calendar_item_category_check" CHECK("category" IN ('match', 'broadcast', 'result_update', 'technical_check', 'rehearsal', 'cross_team_meeting', 'handoff', 'approval', 'information_request', 'planning', 'design', 'development', 'code_review', 'qa', 'release', 'monitoring', 'incident', 'post_event_review')),
	CONSTRAINT "calendar_item_status_check" CHECK("status" IN ('draft', 'confirmed', 'ready', 'live', 'completed', 'delayed', 'cancelled', 'backlog', 'planned', 'in_progress', 'in_review', 'qa', 'ready_to_release', 'released', 'rolled_back')),
	CONSTRAINT "calendar_item_visibility_check" CHECK("visibility" IN ('internal', 'public')),
	CONSTRAINT "calendar_item_risk_level_check" CHECK("risk_level" IS NULL OR "risk_level" IN ('low', 'medium', 'high')),
	CONSTRAINT "calendar_item_game_check" CHECK("game" IS NULL OR "game" IN ('tft', 'valorant', 'rov')),
	CONSTRAINT "calendar_item_time_check" CHECK("end_at" > "start_at"),
	CONSTRAINT "calendar_item_qa_result_check" CHECK("qa_result" IS NULL OR "qa_result" IN ('passed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `calendar_item_department` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`department_id` text NOT NULL,
	`state` text DEFAULT 'involved' NOT NULL,
	`request` text,
	`contact_user_id` text,
	`due_at` integer,
	`response` text,
	`answered_at` integer,
	`answered_by_id` text,
	CONSTRAINT `fk_calendar_item_department_item_id_calendar_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `calendar_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_calendar_item_department_department_id_department_id_fk` FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_calendar_item_department_contact_user_id_user_id_fk` FOREIGN KEY (`contact_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_calendar_item_department_answered_by_id_user_id_fk` FOREIGN KEY (`answered_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "calendar_item_department_state_check" CHECK("state" IN ('involved', 'requested', 'answered'))
);
--> statement-breakpoint
CREATE INDEX `calendar_action_item_item_id_idx` ON `calendar_action_item` (`item_id`);--> statement-breakpoint
CREATE INDEX `calendar_action_item_owner_id_idx` ON `calendar_action_item` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `calendar_action_item_department_id_idx` ON `calendar_action_item` (`department_id`,`status`);--> statement-breakpoint
CREATE INDEX `calendar_change_item_id_idx` ON `calendar_change` (`item_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_checklist_item_uidx` ON `calendar_checklist_item` (`item_id`,`key`);--> statement-breakpoint
CREATE INDEX `calendar_decision_item_id_idx` ON `calendar_decision` (`item_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_dependency_uidx` ON `calendar_dependency` (`item_id`,`depends_on_id`);--> statement-breakpoint
CREATE INDEX `calendar_dependency_depends_on_id_idx` ON `calendar_dependency` (`depends_on_id`);--> statement-breakpoint
CREATE INDEX `calendar_item_start_at_idx` ON `calendar_item` (`start_at`);--> statement-breakpoint
CREATE INDEX `calendar_item_end_at_idx` ON `calendar_item` (`end_at`);--> statement-breakpoint
CREATE INDEX `calendar_item_owner_id_idx` ON `calendar_item` (`owner_id`);--> statement-breakpoint
CREATE INDEX `calendar_item_mode_idx` ON `calendar_item` (`mode`);--> statement-breakpoint
CREATE INDEX `calendar_item_series_id_idx` ON `calendar_item` (`series_id`,`start_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_item_department_uidx` ON `calendar_item_department` (`item_id`,`department_id`);--> statement-breakpoint
CREATE INDEX `calendar_item_department_department_id_idx` ON `calendar_item_department` (`department_id`);