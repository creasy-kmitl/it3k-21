-- Give every seeded department a code. Codes are locked (lock_department_codes),
-- so this unlocks, sets them and relocks. Each UPDATE only touches a department
-- that still has no code, and only while no other department holds that code,
-- so none of them can fail and leave the lock off. A department renamed on a
-- stage is skipped: it keeps no code, stays deletable and grants nothing.
-- A department with a code cannot be deleted (department_code_undeletable).
DROP TRIGGER IF EXISTS `department_code_locked`;--> statement-breakpoint
UPDATE `department` SET `code` = CASE `name`
	WHEN 'สวัสดิการ' THEN 'welfare'
	WHEN 'สถานที่' THEN 'venue'
	WHEN 'พิธีการ' THEN 'ceremony'
	WHEN 'พาเหรด' THEN 'parade'
	WHEN 'พัสดุ' THEN 'supplies'
	WHEN 'พยาบาล' THEN 'medical'
	WHEN 'ประสานงาน' THEN 'coordination'
	WHEN 'กีฬา' THEN 'sports'
	WHEN 'การเงิน' THEN 'finance'
	WHEN 'Sponsor' THEN 'sponsor'
	WHEN 'Production' THEN 'production'
	WHEN 'PR' THEN 'pr'
	WHEN 'Merchandise' THEN 'merchandise'
	WHEN 'Art' THEN 'art'
END
WHERE `code` IS NULL
	AND `name` IN (
		'สวัสดิการ', 'สถานที่', 'พิธีการ', 'พาเหรด', 'พัสดุ', 'พยาบาล', 'ประสานงาน',
		'กีฬา', 'การเงิน', 'Sponsor', 'Production', 'PR', 'Merchandise', 'Art'
	)
	AND NOT EXISTS (
		SELECT 1 FROM `department` AS `taken`
		WHERE `taken`.`code` = CASE `department`.`name`
			WHEN 'สวัสดิการ' THEN 'welfare'
			WHEN 'สถานที่' THEN 'venue'
			WHEN 'พิธีการ' THEN 'ceremony'
			WHEN 'พาเหรด' THEN 'parade'
			WHEN 'พัสดุ' THEN 'supplies'
			WHEN 'พยาบาล' THEN 'medical'
			WHEN 'ประสานงาน' THEN 'coordination'
			WHEN 'กีฬา' THEN 'sports'
			WHEN 'การเงิน' THEN 'finance'
			WHEN 'Sponsor' THEN 'sponsor'
			WHEN 'Production' THEN 'production'
			WHEN 'PR' THEN 'pr'
			WHEN 'Merchandise' THEN 'merchandise'
			WHEN 'Art' THEN 'art'
		END
	);--> statement-breakpoint
CREATE TRIGGER `department_code_locked`
BEFORE UPDATE OF `code` ON `department`
WHEN NEW.`code` IS NOT OLD.`code`
BEGIN
	SELECT RAISE(ABORT, 'department_code_protected: a department code cannot change');
END;
