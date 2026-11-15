-- Template: give a department that has no code one. Copy into a new custom
-- migration (`bunx drizzle-kit generate --custom --name=<name>` in packages/db)
-- and replace __CODE__ and __NAME__. A department that already has a code keeps
-- it forever: to give it rights, reserve that code instead (RESERVED_DEPARTMENT_CODES
-- and DEPARTMENT_CAPABILITIES), no migration needed.
--
-- Before you write it, read the department's current name on every stage
-- (prod, staging): admins can rename departments, and ids differ per stage.
--
-- Each step is safe if the next one fails. D1 may not run these statements as
-- one transaction, so the order matters:
--   1. Unlock codes (lock_department_codes).
--   2. Set the code. This UPDATE cannot fail: it only touches the named
--      department while it has no code and no department already has this one.
--   3. Relock. The trigger must match lock_department_codes exactly; a test
--      compares the final trigger with it.
--   4. Fail the deploy if no department has the code (for example, a stage
--      renamed the department): `name` is NOT NULL, so this INSERT aborts the
--      migration. The lock is already back, and the migration runs again on
--      the next deploy.
DROP TRIGGER IF EXISTS `department_code_locked`;--> statement-breakpoint
UPDATE `department` SET `code` = '__CODE__'
WHERE `name` = '__NAME__'
	AND `code` IS NULL
	AND NOT EXISTS (SELECT 1 FROM `department` WHERE `code` = '__CODE__');--> statement-breakpoint
CREATE TRIGGER `department_code_locked`
BEFORE UPDATE OF `code` ON `department`
WHEN NEW.`code` IS NOT OLD.`code`
BEGIN
	SELECT RAISE(ABORT, 'department_code_protected: a department code cannot change');
END;--> statement-breakpoint
INSERT INTO `department` (`id`, `name`)
SELECT 'missing-department-code:__CODE__', NULL
WHERE NOT EXISTS (SELECT 1 FROM `department` WHERE `code` = '__CODE__');
