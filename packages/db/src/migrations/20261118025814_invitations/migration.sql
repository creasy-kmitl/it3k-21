CREATE TABLE `invitation` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL,
	`kind` text NOT NULL,
	`department_id` text,
	`invited_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_user_id` text,
	`revoked_at` integer,
	CONSTRAINT `fk_invitation_department_id_department_id_fk` FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_invitation_invited_by_user_id_fk` FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_invitation_accepted_user_id_user_id_fk` FOREIGN KEY (`accepted_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "invitation_kind_check" CHECK("kind" IN ('guest', 'participant', 'athlete', 'staff', 'head', 'vicehead')),
	CONSTRAINT "invitation_department_check" CHECK(("kind" IN ('staff', 'head', 'vicehead')) = ("department_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_open_email_uidx` ON `invitation` (`email`) WHERE "invitation"."accepted_at" is null and "invitation"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX `invitation_created_idx` ON `invitation` (`created_at`);