-- Every event made before ticket types gets one type, "ทั่วไป", that keeps its
-- old rules: anyone at a general event, only listed athletes at a sport one,
-- one ticket each, no seat limit of its own (the event's cap still applies).
-- Each old ticket moves onto it, and each old check-in onto its ticket.
INSERT INTO `event_ticket_type` (`id`, `event_id`, `name`, `max_per_user`, `open`, `sort_order`, `listed_only`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
		substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	`id`, 'ทั่วไป', 1, 1, 0, `type` = 'sport'
FROM `event`
WHERE NOT EXISTS (SELECT 1 FROM `event_ticket_type` WHERE `event_ticket_type`.`event_id` = `event`.`id`);--> statement-breakpoint
UPDATE `event_ticket` SET `ticket_type_id` = (
	SELECT `id` FROM `event_ticket_type`
	WHERE `event_ticket_type`.`event_id` = `event_ticket`.`event_id`
	ORDER BY `sort_order`, `id` LIMIT 1
) WHERE `ticket_type_id` IS NULL;--> statement-breakpoint
UPDATE `event_checkin` SET `ticket_id` = (
	SELECT `id` FROM `event_ticket`
	WHERE `event_ticket`.`event_id` = `event_checkin`.`event_id`
		AND `event_ticket`.`user_id` = `event_checkin`.`user_id`
	ORDER BY `created_at`, `id` LIMIT 1
) WHERE `ticket_id` IS NULL;
