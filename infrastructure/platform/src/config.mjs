import { isIP } from 'node:net'

function required(env, name) {
	const value = env[name]?.trim()
	if (!value) throw new Error(`${name} is required`)
	return value
}

function positiveInteger(env, name, fallback) {
	const value = env[name]?.toString().trim() || fallback.toString()
	if (!/^\d+$/.test(value) || Number(value) < 1)
		throw new Error(`${name} must be a positive integer`)
	return Number(value)
}

function booleanValue(env, name, fallback) {
	const value = env[name]?.toString().trim() || fallback.toString()
	if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false`)
	return value === 'true'
}

export function parseSshCidrs(value) {
	const cidrs = value
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
	if (!cidrs.length) throw new Error('SSH_ALLOWED_CIDRS must contain at least one CIDR')
	for (const cidr of cidrs) {
		const [address, prefix, ...rest] = cidr.split('/')
		const family = isIP(address)
		const numericPrefix = Number(prefix)
		if (rest.length || !family || !/^\d+$/.test(prefix ?? ''))
			throw new Error(`invalid SSH CIDR: ${cidr}`)
		if (
			(family === 4 && (numericPrefix < 0 || numericPrefix > 32)) ||
			(family === 6 && (numericPrefix < 0 || numericPrefix > 128))
		)
			throw new Error(`invalid SSH CIDR prefix: ${cidr}`)
	}
	return cidrs
}

export function isOpenSshPublicKey(value) {
	return /^(?:ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/]+={0,2}(?: [A-Za-z0-9._@+-]+)?$/.test(
		value
	)
}

export function loadPlatformConfig(env = process.env) {
	const architecture = required(env, 'HETZNER_SERVER_ARCHITECTURE')
	if (architecture !== 'amd64') throw new Error('published images require amd64')
	const identityVolumeSize = positiveInteger(env, 'IDENTITY_VOLUME_SIZE_GB', 40)
	const platformVolumeSize = positiveInteger(env, 'PLATFORM_VOLUME_SIZE_GB', 80)
	if (identityVolumeSize < 30 || platformVolumeSize < 40)
		throw new Error('identity volume must be >=30 GiB and platform volume >=40 GiB')
	return {
		environment: env.DEPLOYMENT_ENVIRONMENT?.trim() || 'next',
		deployUser: 'aven-deploy',
		identityDeploymentId: 'aven-identity-v1',
		platformDeploymentId: 'aven-platform-v1',
		identityHostname: env.IDENTITY_HOSTNAME?.trim() || 'aven.id',
		platformHostnames: {
			apex: 'aven.ceo',
			api: 'api.aven.ceo',
			checkout: 'my.aven.ceo'
		},
		platformDnsZone: 'aven.ceo',
		location: required(env, 'HETZNER_LOCATION'),
		identityServerType: env.IDENTITY_SERVER_TYPE?.trim() || required(env, 'HETZNER_SERVER_TYPE'),
		platformServerType: env.PLATFORM_SERVER_TYPE?.trim() || required(env, 'HETZNER_SERVER_TYPE'),
		architecture,
		osImage: required(env, 'HETZNER_OS_IMAGE'),
		identityVolumeSize,
		platformVolumeSize,
		enableBackups: booleanValue(env, 'HETZNER_ENABLE_BACKUPS', 'true'),
		manageApexDns: booleanValue(env, 'MANAGE_AVEN_CEO_APEX_DNS', 'false'),
		sshAllowedCidrs: parseSshCidrs(required(env, 'SSH_ALLOWED_CIDRS'))
	}
}

export function requireProviderToken(env, name) {
	const token = required(env, name)
	if (token.length < 20) throw new Error(`${name} is implausibly short`)
	return token
}
