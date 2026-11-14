-- The sports and divisions the event starts with. Sport managers can edit,
-- add and remove them afterwards; codes are what other rows and the web app
-- refer to, so these keep stable codes.
INSERT INTO `sport` (`id`, `code`, `name`, `icon`, `sort_order`) VALUES
	(lower(hex(randomblob(16))), 'football', 'กีฬาฟุตบอล', 'football', 10),
	(lower(hex(randomblob(16))), 'athletics', 'กีฬากรีฑา', 'athletics', 20),
	(lower(hex(randomblob(16))), 'basketball', 'กีฬาบาสเกตบอล', 'basketball', 30),
	(lower(hex(randomblob(16))), 'table-tennis', 'กีฬาเทเบิลเทนนิส', 'table-tennis', 40),
	(lower(hex(randomblob(16))), 'chairball', 'กีฬาแชร์บอล', 'chairball', 50),
	(lower(hex(randomblob(16))), 'badminton', 'กีฬาแบดมินตัน', 'badminton', 60),
	(lower(hex(randomblob(16))), 'petanque', 'กีฬาเปตอง', 'petanque', 70),
	(lower(hex(randomblob(16))), 'folk', 'กีฬาพื้นบ้าน', 'folk', 80),
	(lower(hex(randomblob(16))), 'esports', 'กีฬา Esports', 'esports', 90);
--> statement-breakpoint
WITH `seed` (`sport`, `code`, `name`, `gender`, `format`, `shirt`, `rank`, `game`, `sort`) AS (VALUES
	('football', 'football', 'ฟุตบอล', 'open', 'team', 1, 0, 0, 10),
	('athletics', 'athletics-100m-male', 'กรีฑา 100 m ชาย', 'male', 'individual', 0, 0, 0, 10),
	('athletics', 'athletics-100m-female', 'กรีฑา 100 m หญิง', 'female', 'individual', 0, 0, 0, 20),
	('athletics', 'athletics-400m-male', 'กรีฑา 400 m ชาย', 'male', 'individual', 0, 0, 0, 30),
	('athletics', 'athletics-400m-female', 'กรีฑา 400 m หญิง', 'female', 'individual', 0, 0, 0, 40),
	('athletics', 'athletics-4x100m-male', 'กรีฑา 4x100 m ชาย', 'male', 'team', 0, 0, 0, 50),
	('athletics', 'athletics-4x100m-female', 'กรีฑา 4x100 m หญิง', 'female', 'team', 0, 0, 0, 60),
	('basketball', 'basketball-5x5-male', 'บาสเกตบอล ทีมชาย (5x5)', 'male', 'team', 1, 0, 0, 10),
	('basketball', 'basketball-3x3-female', 'บาสเกตบอล ทีมหญิง (3x3)', 'female', 'team', 1, 0, 0, 20),
	('table-tennis', 'table-tennis-singles-male', 'เทเบิลเทนนิส เดี่ยวชาย', 'male', 'individual', 0, 0, 0, 10),
	('table-tennis', 'table-tennis-singles-female', 'เทเบิลเทนนิส เดี่ยวหญิง', 'female', 'individual', 0, 0, 0, 20),
	('table-tennis', 'table-tennis-doubles-male', 'เทเบิลเทนนิส คู่ชาย', 'male', 'pair', 0, 0, 0, 30),
	('table-tennis', 'table-tennis-doubles-female', 'เทเบิลเทนนิส คู่หญิง', 'female', 'pair', 0, 0, 0, 40),
	('table-tennis', 'table-tennis-doubles-mixed', 'เทเบิลเทนนิส คู่ผสม', 'mixed', 'pair', 0, 0, 0, 50),
	('chairball', 'chairball-male', 'แชร์บอล ทีมชาย', 'male', 'team', 0, 0, 0, 10),
	('chairball', 'chairball-female', 'แชร์บอล ทีมหญิง', 'female', 'team', 0, 0, 0, 20),
	('badminton', 'badminton-singles-male', 'แบดมินตัน เดี่ยวชาย', 'male', 'individual', 0, 1, 0, 10),
	('badminton', 'badminton-singles-female', 'แบดมินตัน เดี่ยวหญิง', 'female', 'individual', 0, 1, 0, 20),
	('badminton', 'badminton-doubles-male', 'แบดมินตัน คู่ชาย', 'male', 'pair', 0, 0, 0, 30),
	('badminton', 'badminton-doubles-female', 'แบดมินตัน คู่หญิง', 'female', 'pair', 0, 0, 0, 40),
	('badminton', 'badminton-doubles-mixed', 'แบดมินตัน คู่ผสม', 'mixed', 'pair', 0, 0, 0, 50),
	('petanque', 'petanque-male', 'เปตอง ทีมชาย', 'male', 'team', 0, 0, 0, 10),
	('petanque', 'petanque-female', 'เปตอง ทีมหญิง', 'female', 'team', 0, 0, 0, 20),
	('petanque', 'petanque-mixed', 'เปตอง ทีมผสม', 'mixed', 'team', 0, 0, 0, 30),
	('folk', 'folk-tug-of-war', 'ชักเย่อ', 'open', 'team', 0, 0, 0, 10),
	('folk', 'folk-relay', 'วิ่งเปรี้ยว', 'open', 'team', 0, 0, 0, 20),
	('folk', 'folk-obstacle-eating', 'กินวิบาก', 'open', 'team', 0, 0, 0, 30),
	('esports', 'esports-rov', 'ROV', 'open', 'team', 0, 0, 1, 10),
	('esports', 'esports-valorant', 'Valorant', 'open', 'team', 0, 0, 1, 20),
	('esports', 'esports-tft', 'TFT', 'open', 'individual', 0, 0, 1, 30)
)
INSERT INTO `sport_division` (
	`id`, `sport_id`, `code`, `name`, `gender`, `format`,
	`requires_shirt_number`, `requires_badminton_rank`, `requires_game_profile`, `sort_order`
)
SELECT lower(hex(randomblob(16))), `sport`.`id`, `seed`.`code`, `seed`.`name`, `seed`.`gender`,
	`seed`.`format`, `seed`.`shirt`, `seed`.`rank`, `seed`.`game`, `seed`.`sort`
FROM `seed` JOIN `sport` ON `sport`.`code` = `seed`.`sport`;
