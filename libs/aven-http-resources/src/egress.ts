import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

export class HttpTransportError extends Error {
	constructor(readonly code: string) {
		super(code)
	}
}

// Conservative public-only baseline based on IANA's special-purpose registries.
// Translated/tunnel IPv6 is not an alternative route around the IPv4 policy.
const deniedV4 = new BlockList()
for (const [address, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.88.99.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4]
] as const)
	deniedV4.addSubnet(address, prefix, 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
const deniedV6 = new BlockList()
for (const [address, prefix] of [
	['2001::', 23],
	['2001:db8::', 32],
	['2002::', 16],
	['3fff::', 20]
] as const)
	deniedV6.addSubnet(address, prefix, 'ipv6')

export function isPublicAddress(address: string): boolean {
	const family = isIP(address)
	return family === 4
		? !deniedV4.check(address, 'ipv4')
		: family === 6 && globalV6.check(address, 'ipv6') && !deniedV6.check(address, 'ipv6')
}

export interface PinnedAddress {
	address: string
	family: 4 | 6
}
/** Host-owned policy only. Never accept this value from an Actor or request artifact. */
export interface NetworkPolicy {
	/** Public HTTPS origins allowed by deployment/provider admission. No wildcard. */
	allowedOrigins: readonly string[]
	/** Exact loopback test origins, never private-LAN or arbitrary host exceptions. */
	localTestOrigins?: readonly string[]
}

export async function pinDestination(
	url: URL,
	policy: NetworkPolicy,
	signal: AbortSignal
): Promise<PinnedAddress> {
	const hostname = url.hostname.replace(/^\[|\]$/g, '')
	const local = policy.localTestOrigins?.includes(url.origin) === true
	if (local) {
		if (
			!['127.0.0.1', '::1', 'localhost'].includes(hostname) ||
			!['http:', 'https:'].includes(url.protocol)
		)
			throw new HttpTransportError('HTTP_EGRESS_POLICY_INVALID')
	} else if (url.protocol !== 'https:' || !policy.allowedOrigins.includes(url.origin)) {
		throw new HttpTransportError('HTTP_ORIGIN_NOT_ADMITTED')
	}
	if (signal.aborted) throw new HttpTransportError('HTTP_REQUEST_ABORTED')
	// Resolve once and use only the returned address at connect time. A hostname
	// resolving to both public and restricted addresses is rejected as a whole.
	const family = isIP(hostname)
	let addresses: { address: string; family: number }[]
	try {
		addresses = family
			? [{ address: hostname, family }]
			: await abortable(lookup(hostname, { all: true, verbatim: true }), signal)
	} catch {
		throw new HttpTransportError(signal.aborted ? 'HTTP_REQUEST_ABORTED' : 'HTTP_DNS_FAILED')
	}
	if (
		!addresses.length ||
		addresses.length > 64 ||
		addresses.some(
			(value) =>
				![4, 6].includes(value.family) ||
				(local ? !['127.0.0.1', '::1'].includes(value.address) : !isPublicAddress(value.address))
		)
	)
		throw new HttpTransportError('HTTP_ADDRESS_NOT_ADMITTED')
	if (signal.aborted) throw new HttpTransportError('HTTP_REQUEST_ABORTED')
	return addresses[0] as PinnedAddress
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const aborted = () => reject(new HttpTransportError('HTTP_REQUEST_ABORTED'))
		signal.addEventListener('abort', aborted, { once: true })
		if (signal.aborted) aborted()
		void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
	})
}
