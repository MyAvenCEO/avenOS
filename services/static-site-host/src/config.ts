import { isIP } from 'node:net'

interface BaseSiteHostConfig {
	hostname: string
	port: number
	dataRoot: string
	mode: 'managed' | 'snapshot'
	maxFiles: number
	maxBytes: number
	maxConcurrentSyncs: number
}

export interface ManagedSiteHostConfig extends BaseSiteHostConfig {
	mode: 'managed'
	directoryUrl: string
	statusUrl: string
	bearerToken: string
	allowedIpv4: Set<string>
	allowedIpv6: Set<string>
	pollMilliseconds: number
	dnsGraceMilliseconds: number
}

export interface SnapshotSiteHostConfig extends BaseSiteHostConfig {
	mode: 'snapshot'
}

export type SiteHostConfig = ManagedSiteHostConfig | SnapshotSiteHostConfig

function required(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]
	if (!value) throw new Error(`${key} is required`)
	return value
}

function positive(value: string | undefined, fallback: number): number {
	const parsed = Number(value ?? fallback)
	if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('expected a positive integer')
	return parsed
}

function addresses(value: string, family: 4 | 6): Set<string> {
	const result = new Set(
		value
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean)
	)
	if (!result.size || [...result].some((address) => isIP(address) !== family))
		throw new Error(`SITE_HOST_ALLOWED_IPV${family} contains an invalid address`)
	return result
}

function httpUrl(value: string, key: string): URL {
	const url = new URL(value)
	if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${key} must use HTTP or HTTPS`)
	return url
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SiteHostConfig {
	const listen = env.SITE_HOST_LISTEN ?? '0.0.0.0:8093'
	const separator = listen.lastIndexOf(':')
	if (separator < 1) throw new Error('SITE_HOST_LISTEN must be host:port')
	const mode = env.SITE_HOST_MODE ?? 'managed'
	if (!['managed', 'snapshot'].includes(mode))
		throw new Error('SITE_HOST_MODE must be managed or snapshot')
	const common = {
		hostname: listen.slice(0, separator),
		port: positive(listen.slice(separator + 1), 8093),
		dataRoot: env.SITE_HOST_DATA_ROOT ?? '/var/lib/aven/static-sites',
		maxFiles: positive(env.SITE_HOST_MAX_FILES, 10000),
		maxBytes: positive(env.SITE_HOST_MAX_BYTES, 268435456),
		maxConcurrentSyncs: positive(env.SITE_HOST_MAX_CONCURRENT_SYNCS, 4)
	}
	if (mode === 'snapshot') return { ...common, mode }
	const token = required(env, 'SITE_HOST_DIRECTORY_BEARER_TOKEN')
	if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error('invalid site host bearer token')
	const directoryUrl = httpUrl(required(env, 'SITE_HOST_DIRECTORY_URL'), 'SITE_HOST_DIRECTORY_URL')
	const statusUrl = httpUrl(
		env.SITE_HOST_STATUS_URL ?? directoryUrl.toString().replace(/\/bindings\/?$/, '/status'),
		'SITE_HOST_STATUS_URL'
	)
	if (statusUrl.origin !== directoryUrl.origin)
		throw new Error('SITE_HOST_DIRECTORY_URL and SITE_HOST_STATUS_URL must have the same origin')
	return {
		...common,
		mode: 'managed',
		directoryUrl: directoryUrl.toString(),
		statusUrl: statusUrl.toString(),
		bearerToken: token,
		allowedIpv4: addresses(required(env, 'SITE_HOST_ALLOWED_IPV4'), 4),
		allowedIpv6: env.SITE_HOST_ALLOWED_IPV6 ? addresses(env.SITE_HOST_ALLOWED_IPV6, 6) : new Set(),
		pollMilliseconds: positive(env.SITE_HOST_POLL_SECONDS, 60) * 1000,
		dnsGraceMilliseconds: positive(env.SITE_HOST_DNS_GRACE_SECONDS, 86400) * 1000
	}
}
