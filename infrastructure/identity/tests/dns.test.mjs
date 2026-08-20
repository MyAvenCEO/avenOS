import assert from 'node:assert/strict'
import test from 'node:test'
import { identityRecordSpecs } from '../src/dns.mjs'

test('owns only id.next A and AAAA records', () => {
	const records = identityRecordSpecs({
		zone: 'aven.ceo',
		hostname: 'id.next.aven.ceo',
		ttl: 300,
		ipv4: '192.0.2.10',
		ipv6: '2001:db8::10'
	})
	assert.deepEqual(
		records.map(({ name, type, value }) => ({ name, type, value })),
		[
			{ name: 'id.next', type: 'A', value: '192.0.2.10' },
			{ name: 'id.next', type: 'AAAA', value: '2001:db8::10' }
		]
	)
})

test('rejects any other zone or hostname', () => {
	const base = {
		zone: 'aven.ceo',
		hostname: 'id.next.aven.ceo',
		ttl: 300,
		ipv4: '192.0.2.10',
		ipv6: '2001:db8::10'
	}
	assert.throws(() => identityRecordSpecs({ ...base, zone: 'example.com' }), /restricted/)
	assert.throws(() => identityRecordSpecs({ ...base, hostname: 'id.aven.ceo' }), /restricted/)
})
