-- Department codes are permanent ids, and some of them grant rights
-- (apps/server/src/policies/department-capabilities.ts). Lock them so no edit,
-- from the API, Drizzle Studio or raw SQL, can move or clear a code or delete a
-- department that has one. The triggers hold no list of codes. To set a code
-- on a department that has none, a migration drops department_code_locked,
-- runs the UPDATE, then recreates the trigger exactly as below
-- (packages/db/templates/add-department-code.sql).
CREATE TRIGGER `department_code_locked`
BEFORE UPDATE OF `code` ON `department`
WHEN NEW.`code` IS NOT OLD.`code`
BEGIN
	SELECT RAISE(ABORT, 'department_code_protected: a department code cannot change');
END;--> statement-breakpoint
CREATE TRIGGER `department_code_undeletable`
BEFORE DELETE ON `department`
WHEN OLD.`code` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'department_code_protected: a system department cannot be deleted');
END;
