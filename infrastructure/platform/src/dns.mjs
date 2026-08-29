function record(resourceName, zone, name, type, value, ttl = 300) {
	if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86_400)
		throw new Error('DNS TTL must be 60..86400')
	return { resourceName, zone, name, type, value, ttl }
}

export function manualIdentityRecordSpecs({ hostname, ipv4, ipv6 }) {
	if (hostname !== 'aven.id') throw new Error('identity DNS is restricted to the aven.id apex')
	return [
		{ hostname, name: '@', type: 'A', value: ipv4, ttl: 300 },
		{ hostname, name: '@', type: 'AAAA', value: ipv6, ttl: 300 }
	]
}

export function platformRecordSpecs({ zone, hostnames, ipv4, ipv6, includeApex }) {
	if (
		zone !== 'aven.ceo' ||
		hostnames.apex !== 'aven.ceo' ||
		hostnames.api !== 'api.aven.ceo' ||
		hostnames.checkout !== 'my.aven.ceo'
	)
		throw new Error('platform DNS is restricted to aven.ceo, api.aven.ceo, and my.aven.ceo')
	const records = [
		record('platform-api-a', zone, 'api', 'A', ipv4),
		record('platform-api-aaaa', zone, 'api', 'AAAA', ipv6),
		record('platform-checkout-a', zone, 'my', 'A', ipv4),
		record('platform-checkout-aaaa', zone, 'my', 'AAAA', ipv6)
	]
	if (includeApex)
		records.push(
			record('platform-apex-a', zone, '@', 'A', ipv4),
			record('platform-apex-aaaa', zone, '@', 'AAAA', ipv6)
		)
	return records
}
