import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { type DnsResolver, verifyDns } from '../src/dns.js'

const token = 'test-verification-token'
const tokenHash = createHash('sha256').update(token).digest('hex')

function resolver(overrides: Partial<DnsResolver> = {}): DnsResolver {
	return {
		resolveTxt: async () => [[token]],
		resolve4: async () => ['192.0.2.10'],
		resolve6: async () => [],
		...overrides
	}
}

describe('verifyDns', () => {
	test('requires the ownership TXT record and exact host address', async () => {
		expect(
			await verifyDns('customer.example', tokenHash, new Set(['192.0.2.10']), new Set(), resolver())
		).toEqual({ ok: true })
	})

	test('rejects a mixed A record set', async () => {
		const result = await verifyDns(
			'customer.example',
			tokenHash,
			new Set(['192.0.2.10']),
			new Set(),
			resolver({ resolve4: async () => ['192.0.2.10', '192.0.2.11'] })
		)
		expect(result.ok).toBe(false)
	})

	test('rejects an unapproved AAAA record', async () => {
		const result = await verifyDns(
			'customer.example',
			tokenHash,
			new Set(['192.0.2.10']),
			new Set(),
			resolver({ resolve6: async () => ['2001:db8::10'] })
		)
		expect(result.ok).toBe(false)
	})
})
