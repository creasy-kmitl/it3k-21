-- Heads and viceheads are now whoever holds a `leadership` seat, so drop the
-- duplicate 'head'/'vicehead' account roles (roles are a comma-separated list).
-- An account left with no role falls back to 'staff'.
UPDATE `user`
SET `role` = coalesce(
	nullif(trim(
		replace(replace(',' || replace(`role`, ' ', '') || ',', ',head,', ','), ',vicehead,', ','),
		','
	), ''),
	'staff'
)
WHERE ',' || replace(`role`, ' ', '') || ',' LIKE '%,head,%'
	OR ',' || replace(`role`, ' ', '') || ',' LIKE '%,vicehead,%';
