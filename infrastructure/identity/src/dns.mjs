export function identityRecordSpecs({ zone, hostname, ttl, ipv4, ipv6 }) {
	if (zone !== 'aven.ceo') throw new Error('DNS changes are restricted to aven.ceo')
	if (hostname !== 'id.next.aven.ceo')
		throw new Error('identity DNS is restricted to id.next.aven.ceo')
	if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86_400)
		throw new Error('DNS TTL must be 60..86400')
	return [
		{ resourceName: 'identity-a', name: 'id.next', type: 'A', value: ipv4, zone, ttl },
		{ resourceName: 'identity-aaaa', name: 'id.next', type: 'AAAA', value: ipv6, zone, ttl }
	]
}
