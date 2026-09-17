-- Seed the default IT3K departments (created_at offset keeps display order)
INSERT INTO `department` (`id`, `name`, `created_at`) VALUES
	(lower(hex(randomblob(16))), 'สวัสดิการ', cast(unixepoch('subsecond') * 1000 as integer) + 0),
	(lower(hex(randomblob(16))), 'สถานที่', cast(unixepoch('subsecond') * 1000 as integer) + 1),
	(lower(hex(randomblob(16))), 'พิธีการ', cast(unixepoch('subsecond') * 1000 as integer) + 2),
	(lower(hex(randomblob(16))), 'พาเหรด', cast(unixepoch('subsecond') * 1000 as integer) + 3),
	(lower(hex(randomblob(16))), 'พัสดุ', cast(unixepoch('subsecond') * 1000 as integer) + 4),
	(lower(hex(randomblob(16))), 'พยาบาล', cast(unixepoch('subsecond') * 1000 as integer) + 5),
	(lower(hex(randomblob(16))), 'ประสานงาน', cast(unixepoch('subsecond') * 1000 as integer) + 6),
	(lower(hex(randomblob(16))), 'ทะเบียน', cast(unixepoch('subsecond') * 1000 as integer) + 7),
	(lower(hex(randomblob(16))), 'กีฬา', cast(unixepoch('subsecond') * 1000 as integer) + 8),
	(lower(hex(randomblob(16))), 'การเงิน', cast(unixepoch('subsecond') * 1000 as integer) + 9),
	(lower(hex(randomblob(16))), 'Sponsor', cast(unixepoch('subsecond') * 1000 as integer) + 10),
	(lower(hex(randomblob(16))), 'Production', cast(unixepoch('subsecond') * 1000 as integer) + 11),
	(lower(hex(randomblob(16))), 'PR', cast(unixepoch('subsecond') * 1000 as integer) + 12),
	(lower(hex(randomblob(16))), 'Merchandise', cast(unixepoch('subsecond') * 1000 as integer) + 13),
	(lower(hex(randomblob(16))), 'Art', cast(unixepoch('subsecond') * 1000 as integer) + 14),
	(lower(hex(randomblob(16))), 'Tech/Live', cast(unixepoch('subsecond') * 1000 as integer) + 15);
