const ACCESS_KEY = /^[A-Z0-9]{8,64}$/
const BUCKET_PREFIX = /^[a-z0-9][a-z0-9-]{4,42}[a-z0-9]$/

function required(env, name) {
	const value = env[name]?.trim()
	if (!value) throw new Error(`${name} is required`)
	return value
}

function accessKey(env, name) {
	const value = required(env, name)
	if (!ACCESS_KEY.test(value)) throw new Error(`${name} is not a valid Hetzner S3 access key`)
	return value
}

export function loadBootstrapConfig(env = process.env) {
	const prefix = required(env, 'OBJECT_STORAGE_BUCKET_PREFIX')
	if (!BUCKET_PREFIX.test(prefix))
		throw new Error(
			'OBJECT_STORAGE_BUCKET_PREFIX must be 6-44 lowercase letters, digits, or hyphens'
		)
	const region = env.OBJECT_STORAGE_REGION?.trim() || 'hel1'
	if (!['fsn1', 'nbg1', 'hel1'].includes(region))
		throw new Error('OBJECT_STORAGE_REGION must be fsn1, nbg1, or hel1')
	const projectId = required(env, 'OBJECT_STORAGE_PROJECT_ID')
	if (!/^\d+$/.test(projectId)) throw new Error('OBJECT_STORAGE_PROJECT_ID must be numeric')
	const credentials = Object.fromEntries(
		['identity', 'next', 'production'].map((target) => [
			target,
			{
				deployment: accessKey(env, `${target.toUpperCase()}_DEPLOYMENT_S3_ACCESS_KEY_ID`),
				observer: accessKey(env, `${target.toUpperCase()}_OBSERVER_S3_ACCESS_KEY_ID`)
			}
		])
	)
	return {
		prefix,
		region,
		projectId,
		bootstrapAccessKey: accessKey(env, 'BOOTSTRAP_S3_ACCESS_KEY_ID'),
		bootstrapSecretKey: required(env, 'BOOTSTRAP_S3_SECRET_ACCESS_KEY'),
		credentials
	}
}
