import { createHash } from 'node:crypto'
import { z } from 'zod'

const uuid = z.uuid().transform((v) => v.toLowerCase())
const hasControlCharacter = (value: string) =>
	[...value].some((character) => {
		const code = character.charCodeAt(0)
		return code < 32 || code === 127
	})
const text = (n: number) =>
	z
		.string()
		.min(1)
		.max(n)
		.refine((v) => !hasControlCharacter(v))
const uid = z.number().int().min(1).max(4294967295)
const fence = z.number().int().min(1).max(4294967296)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const source = z.object({ artifactId: uuid, artifactDigest: digest }).strict()
const metadata = z.enum(['internal-date', 'size', 'flags'])
export const imapQuerySchema = z
	.object({
		bindingRef: uuid,
		mailbox: text(1024),
		purpose: text(128),
		criteria: z
			.object({
				internalDate: z
					.object({ since: z.iso.date().optional(), before: z.iso.date().optional() })
					.strict()
					.optional(),
				fromContains: text(256).optional(),
				subjectContains: text(256).optional(),
				seen: z.enum(['any', 'seen', 'unseen']).default('any')
			})
			.strict()
			.default({ seen: 'any' }),
		metadata: z
			.array(metadata)
			.min(1)
			.max(3)
			.default(['internal-date', 'size'])
			.transform((v) => [...new Set(v)].sort()),
		order: z.literal('uid-ascending').default('uid-ascending'),
		limits: z
			.object({
				maximumMatches: z.number().int().min(1).max(1000).default(100),
				maximumCommands: z.number().int().min(4).max(128).default(20),
				maximumSeconds: z.number().int().min(1).max(120).default(30),
				maximumResultBytes: z.number().int().min(1024).max(1048576).default(262144)
			})
			.strict()
			.default({
				maximumMatches: 100,
				maximumCommands: 20,
				maximumSeconds: 30,
				maximumResultBytes: 262144
			}),
		// The host resolves the committed result and checks its original query. Caller
		// data never substitutes an epoch/fence or invents a server continuation handle.
		continuation: source.optional()
	})
	.strict()
	.superRefine((q, ctx) => {
		const bounds = q.criteria.internalDate
		if (bounds?.since && bounds.before && bounds.since >= bounds.before)
			ctx.addIssue({ code: 'custom', message: 'The received-date interval is empty or reversed.' })
	})
export type ImapQuery = z.infer<typeof imapQuerySchema>
export const imapReadSchema = z
	.object({
		bindingRef: uuid,
		accountRef: uuid,
		mailbox: text(1024),
		uidValidity: uid,
		uid,
		purpose: text(128),
		maximumBytes: z
			.number()
			.int()
			.min(1)
			.max(32 * 1024 * 1024),
		selection: source
	})
	.strict()
export type ImapRead = z.infer<typeof imapReadSchema>

const identity = { accountRef: uuid, mailbox: text(1024), uidValidity: uid }
const window = z
	.object({ first: uid, last: uid })
	.strict()
	.refine((v) => v.first <= v.last)
const present = z
	.object({
		uid,
		state: z.literal('present'),
		internalDate: z.iso.datetime({ offset: true }).optional(),
		size: z.number().int().min(0).max(4294967295).optional(),
		flags: z.array(text(256)).max(64).optional()
	})
	.strict()
export const imapQueryResultSchema = z
	.object({
		...identity,
		bindingRef: uuid,
		queryDigest: digest,
		upperUidExclusive: fence,
		scanFromUid: fence,
		nextUid: fence,
		scanned: z.array(window).max(128),
		messages: z
			.array(z.union([present, z.object({ uid, state: z.literal('missing') }).strict()]))
			.max(1000),
		coverage: z.enum(['complete', 'truncated', 'incomplete']),
		stopReason: z
			.enum(['match-limit', 'command-limit', 'time-limit', 'result-byte-limit', 'missing-metadata'])
			.nullable(),
		observedFrom: z.iso.datetime({ offset: true }),
		observedUntil: z.iso.datetime({ offset: true })
	})
	.strict()
	.superRefine((value, ctx) => {
		const fail = () => ctx.addIssue({ code: 'custom', message: 'Invalid mailbox scan coverage.' })
		if (
			value.scanFromUid > value.nextUid ||
			value.nextUid > value.upperUidExclusive ||
			Date.parse(value.observedUntil) < Date.parse(value.observedFrom)
		)
			fail()
		if (
			value.coverage === 'complete' &&
			(value.nextUid !== value.upperUidExclusive || value.stopReason !== null)
		)
			fail()
		if (value.coverage !== 'complete' && value.stopReason === null) fail()
		let last = value.scanFromUid - 1
		for (const w of value.scanned) {
			if (w.first !== last + 1 || w.last >= value.upperUidExclusive) fail()
			last = w.last
		}
		if (value.nextUid !== last + 1) fail()
		const ids = new Set<number>()
		let previous = 0
		for (const row of value.messages) {
			if (
				ids.has(row.uid) ||
				row.uid <= previous ||
				!value.scanned.some((w) => row.uid >= w.first && row.uid <= w.last)
			)
				fail()
			ids.add(row.uid)
			previous = row.uid
			if (row.state === 'missing' && value.coverage === 'complete') fail()
		}
	})
export type ImapQueryResult = z.infer<typeof imapQueryResultSchema>

export function queryDigest(raw: unknown): string {
	// Zod's closed object definitions give stable field order, including nested
	// criteria/limits. Metadata is a normalized set; no unknown JSON remains.
	return createHash('sha256')
		.update(JSON.stringify(imapQuerySchema.parse(raw)))
		.digest('hex')
}
export function readDigest(raw: unknown): string {
	return createHash('sha256')
		.update(JSON.stringify(imapReadSchema.parse(raw)))
		.digest('hex')
}
export function assertSelectedMessage(
	request: ImapRead,
	query: ImapQuery,
	result: ImapQueryResult
): void {
	if (
		result.queryDigest !== queryDigest(query) ||
		request.bindingRef !== query.bindingRef ||
		result.bindingRef !== query.bindingRef ||
		request.purpose !== query.purpose ||
		request.mailbox !== result.mailbox ||
		request.mailbox !== query.mailbox ||
		request.accountRef !== result.accountRef ||
		request.uidValidity !== result.uidValidity ||
		!result.messages.some((m) => m.uid === request.uid && m.state === 'present')
	)
		throw new Error('MAIL_SELECTION_MISMATCH')
}
/** Numeric UID windows only: a sparse mailbox is bounded by command count. A new
 * arrival at UIDNEXT or above cannot enter this observation. Never emit '*'/reverse. */
export function nextUidWindow(
	next: number,
	upperExclusive: number,
	remainingMatches: number
): { first: number; last: number } | null {
	fence.parse(next)
	fence.parse(upperExclusive)
	z.number().int().min(0).max(1000).parse(remainingMatches)
	if (next >= upperExclusive || !remainingMatches) return null
	return { first: next, last: Math.min(upperExclusive - 1, next + remainingMatches - 1) }
}
