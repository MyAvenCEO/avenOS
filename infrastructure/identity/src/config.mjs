import { isIP } from 'node:net'

function required(env, name) {
	const value = env[name]?.trim()
	if (!value) throw new Error(`${name} is required`)
	return value
}

function positiveInteger(env, name) {
	const value = required(env, name)
	if (!/^\d+$/.test(value) || Number(value) < 1)
		throw new Error(`${name} must be a positive integer`)
	return Number(value)
}

export function parseSshCidrs(value) {
	const cidrs = value
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
	if (cidrs.length === 0) throw new Error('SSH_ALLOWED_CIDRS must contain at least one CIDR')
	for (const cidr of cidrs) {
		const [address, prefix, ...rest] = cidr.split('/')
		const family = isIP(address)
		const numericPrefix = Number(prefix)
		if (rest.length || !family || !/^\d+$/.test(prefix ?? ''))
			throw new Error(`invalid SSH CIDR: ${cidr}`)
		if (
			(family === 4 && (numericPrefix < 0 || numericPrefix > 32)) ||
			(family === 6 && (numericPrefix < 0 || numericPrefix > 128))
		) {
			throw new Error(`invalid SSH CIDR prefix: ${cidr}`)
		}
	}
	return cidrs
}

export function isOpenSshPublicKey(value) {
	return /^(?:ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/]+={0,2}(?: [A-Za-z0-9._@+-]+)?$/.test(
		value
	)
}

function validateGlobalSshAccess(cidrs) {
	const globalCidrs = new Set(['0.0.0.0/0', '::/0'])
	if (!cidrs.some((cidr) => globalCidrs.has(cidr))) return
	if (cidrs.length !== globalCidrs.size || !cidrs.every((cidr) => globalCidrs.has(cidr))) {
		throw new Error('global SSH access must use exactly 0.0.0.0/0 and ::/0')
	}
}

function booleanValue(env, name) {
	const value = required(env, name)
	if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false`)
	return value === 'true'
}

export function loadIdentityConfig(env = process.env) {
	const architecture = required(env, 'HETZNER_SERVER_ARCHITECTURE')
	if (architecture !== 'amd64') throw new Error('the published identity image requires amd64')
	const volumeSize = positiveInteger(env, 'HETZNER_VOLUME_SIZE_GB')
	if (volumeSize < 30) throw new Error('HETZNER_VOLUME_SIZE_GB must be at least 30')
	const sshAllowedCidrs = parseSshCidrs(required(env, 'SSH_ALLOWED_CIDRS'))
	validateGlobalSshAccess(sshAllowedCidrs)
	const sshPublicKey = required(env, 'DEPLOY_SSH_PUBLIC_KEY')
	if (!isOpenSshPublicKey(sshPublicKey))
		throw new Error('DEPLOY_SSH_PUBLIC_KEY is not an OpenSSH public key')

	return {
		deploymentId: 'aven-identity-next-1',
		deployUser: 'aven-deploy',
		identityHostname: 'id.next.aven.ceo',
		dnsZone: 'aven.ceo',
		location: required(env, 'HETZNER_LOCATION'),
		serverType: required(env, 'HETZNER_SERVER_TYPE'),
		architecture,
		osImage: required(env, 'HETZNER_OS_IMAGE'),
		volumeSize,
		enableBackups: booleanValue(env, 'HETZNER_ENABLE_BACKUPS'),
		sshAllowedCidrs,
		sshPublicKey
	}
}

export function requireProviderToken(env, name) {
	const token = required(env, name)
	if (token.length < 20) throw new Error(`${name} is implausibly short`)
	return token
}
