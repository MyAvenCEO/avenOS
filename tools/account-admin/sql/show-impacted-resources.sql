SELECT
	'static-site' AS resource_type,
	binding.id AS resource_id,
	binding.hostname,
	binding.runtime_status,
	owned_name.name AS aven_name
FROM static_site_bindings AS binding
JOIN customer_environments AS environment ON environment.id = binding.environment_id
JOIN names AS owned_name ON owned_name.name = environment.name
JOIN "user" AS owner ON owner.id = environment.owner_user_id
WHERE (owner.id = :'selector' OR lower(owner.email) = lower(:'selector'))
	AND owner.role = 'admin'
	AND binding.hostname LIKE '%.aven.ceo'
	AND binding.desired_status = 'active'
	AND owned_name.status = 'owned'
ORDER BY binding.hostname, binding.id;
