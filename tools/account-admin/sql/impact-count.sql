SELECT count(*)
FROM static_site_bindings AS binding
JOIN customer_environments AS environment ON environment.id = binding.environment_id
JOIN names AS owned_name ON owned_name.name = environment.name
JOIN "user" AS owner ON owner.id = environment.owner_user_id
WHERE (owner.id = :'selector' OR lower(owner.email) = lower(:'selector'))
	AND owner.role = 'admin'
	AND (binding.hostname = 'aven.ceo' OR binding.hostname LIKE '%.aven.ceo')
	AND binding.desired_status = 'active'
	AND owned_name.status = 'owned';
