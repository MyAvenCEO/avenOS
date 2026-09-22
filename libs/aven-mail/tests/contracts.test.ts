import { describe, expect, it } from 'vitest'
import {
	assertSelectedMessage,
	imapQueryResultSchema,
	imapQuerySchema,
	imapReadSchema,
	nextUidWindow,
	queryDigest
} from '../src/contracts'

const bindingRef = '11111111-1111-4111-8111-111111111111',
	accountRef = '22222222-2222-4222-8222-222222222222'
const artifactId = '33333333-3333-4333-8333-333333333333'
const query = imapQuerySchema.parse({ bindingRef, mailbox: 'INBOX', purpose: 'synthetic-garden' })
const result = {
	bindingRef,
	accountRef,
	mailbox: 'INBOX',
	uidValidity: 8,
	queryDigest: queryDigest(query),
	upperUidExclusive: 5,
	scanFromUid: 1,
	nextUid: 5,
	scanned: [{ first: 1, last: 4 }],
	messages: [{ uid: 2, state: 'present' as const, size: 12 }],
	coverage: 'complete' as const,
	stopReason: null,
	observedFrom: '2026-01-06T12:00:00Z',
	observedUntil: '2026-01-06T12:00:01Z'
}
describe('bounded mail contracts', () => {
	it('normalizes metadata sets and retains multilingual literal predicates', () => {
		const q = {
			...query,
			criteria: { subjectContains: 'Gänseblümchen 花' },
			metadata: ['size', 'flags', 'size']
		}
		expect(queryDigest(q)).toBe(queryDigest({ ...q, metadata: ['flags', 'size'] }))
		expect(imapQuerySchema.parse(q).criteria.subjectContains).toBe('Gänseblümchen 花')
	})
	it.each([
		{ criteria: { internalDate: { since: '2026-02-30' } } },
		{ criteria: { internalDate: { since: '2026-02-02', before: '2026-02-01' } } },
		{ criteria: { raw: 'ALL' } },
		{ host: 'attacker.example.test' },
		{ limits: { maximumCommands: 999 } },
		{ criteria: { subjectContains: 'x\r\nSTORE' } }
	])('rejects arbitrary commands, endpoints and invalid limits (%j)', (patch) =>
		expect(imapQuerySchema.safeParse({ ...query, ...patch }).success).toBe(false)
	)
	it('never produces wildcard, reversed or beyond-fence UID windows', () => {
		expect(nextUidWindow(1, 1, 100)).toBeNull()
		expect(nextUidWindow(5, 7, 100)).toEqual({ first: 5, last: 6 })
		expect(nextUidWindow(4294967295, 4294967296, 100)).toEqual({
			first: 4294967295,
			last: 4294967295
		})
		expect(nextUidWindow(8, 10, 0)).toBeNull()
		expect(() => nextUidWindow(0, 10, 1)).toThrow()
	})
	it('accepts explicit complete and bounded partial coverage', () => {
		expect(imapQueryResultSchema.parse(result)).toEqual(result)
		expect(
			imapQueryResultSchema.safeParse({
				...result,
				nextUid: 3,
				scanned: [{ first: 1, last: 2 }],
				coverage: 'truncated',
				stopReason: 'match-limit'
			}).success
		).toBe(true)
	})
	it.each([
		{ scanned: [], messages: [] },
		{ scanned: [{ first: 3, last: 4 }], messages: [] },
		{ scanFromUid: 6 },
		{ nextUid: 6 },
		{ nextUid: 4 },
		{
			scanned: [
				{ first: 1, last: 2 },
				{ first: 4, last: 4 }
			]
		},
		{ messages: [{ uid: 5, state: 'present' }] },
		{ messages: [{ uid: 2, state: 'missing' }] },
		{
			messages: [
				{ uid: 2, state: 'present' },
				{ uid: 2, state: 'present' }
			]
		},
		{ observedUntil: '2026-01-06T11:00:00Z' }
	])('rejects false coverage (%j)', (patch) =>
		expect(imapQueryResultSchema.safeParse({ ...result, ...patch }).success).toBe(false)
	)
	it('allows a zero-work empty mailbox and retains the start of a continuation page', () => {
		expect(
			imapQueryResultSchema.safeParse({
				...result,
				upperUidExclusive: 1,
				nextUid: 1,
				scanned: [],
				messages: []
			}).success
		).toBe(true)
		expect(
			imapQueryResultSchema.safeParse({
				...result,
				scanFromUid: 3,
				scanned: [{ first: 3, last: 4 }],
				messages: []
			}).success
		).toBe(true)
		expect(
			imapQueryResultSchema.safeParse({
				...result,
				scanFromUid: 3,
				nextUid: 3,
				scanned: [],
				messages: [],
				coverage: 'truncated',
				stopReason: 'command-limit'
			}).success
		).toBe(true)
	})
	it('binds message reads to the selected account, mailbox, epoch and query', () => {
		const request = imapReadSchema.parse({
			bindingRef,
			accountRef,
			mailbox: 'INBOX',
			uidValidity: 8,
			uid: 2,
			purpose: query.purpose,
			maximumBytes: 2048,
			selection: { artifactId, artifactDigest: 'a'.repeat(64) }
		})
		expect(() => assertSelectedMessage(request, query, result)).not.toThrow()
		for (const patch of [
			{ uid: 3 },
			{ uidValidity: 9 },
			{ mailbox: 'Other' },
			{ purpose: 'another-purpose' },
			{ accountRef: bindingRef }
		])
			expect(() => assertSelectedMessage({ ...request, ...patch }, query, result)).toThrow(
				'MAIL_SELECTION_MISMATCH'
			)
	})
})
