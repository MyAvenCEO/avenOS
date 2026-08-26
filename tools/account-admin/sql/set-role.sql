BEGIN;

WITH guard AS MATERIALIZED (
	SELECT 1 / CASE WHEN count(*) = 1 THEN 1 ELSE 0 END AS one_match
	FROM "user"
	WHERE id = :'selector' OR lower(email) = lower(:'selector')
), resource_guard AS MATERIALIZED (
	SELECT
		count(*) AS dependent_resources,
		1 / CASE
		WHEN :'new_role' <> 'user' OR :'allow_resource_suspension'::boolean OR count(*) = 0 THEN 1
		ELSE 0
		END AS resources_acknowledged
	FROM static_site_bindings AS binding
	JOIN customer_environments AS environment ON environment.id = binding.environment_id
	JOIN names AS owned_name ON owned_name.name = environment.name
	JOIN "user" AS owner ON owner.id = environment.owner_user_id
	WHERE (owner.id = :'selector' OR lower(owner.email) = lower(:'selector'))
		AND owner.role = 'admin'
		AND (binding.hostname = 'aven.ceo' OR binding.hostname LIKE '%.aven.ceo')
		AND binding.desired_status = 'active'
		AND owned_name.status = 'owned'
), target AS MATERIALIZED (
	SELECT id, role AS previous_role
	FROM "user"
	WHERE id = :'selector' OR lower(email) = lower(:'selector')
	FOR UPDATE
), changed AS (
	UPDATE "user" AS u
	SET role = :'new_role', updated_at = now()
	FROM target, guard, resource_guard
	WHERE u.id = target.id
		AND guard.one_match = 1
		AND resource_guard.resources_acknowledged = 1
	RETURNING
		u.id,
		u.email,
		u.name,
		u.role,
		u.email_verified,
		u.updated_at,
		target.previous_role,
		resource_guard.dependent_resources
), audited AS (
	INSERT INTO audit_events (id, event_type, target_user_id, metadata, created_at)
	SELECT
		md5(random()::text || clock_timestamp()::text || id || current_user),
		:'event_type',
		id,
		jsonb_build_object(
			'operatorDatabaseRole', current_user,
			'previousRole', previous_role,
			'newRole', role,
			'dependentResources', dependent_resources,
			'resourceSuspensionAcknowledged', :'allow_resource_suspension'::boolean
		),
		now()
	FROM changed
)
SELECT id, email, name, role, email_verified, updated_at
FROM changed;

COMMIT;
