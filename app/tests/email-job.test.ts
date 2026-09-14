import { expect, test } from 'bun:test'
import type { EmailAttachment } from '../src/lib/artifacts/email-import'
import {
	EmailImportJob,
	type EmailRequest,
	type EmailResult,
	initialEmailJobState
} from '../src/lib/artifacts/email-job'

const request: EmailRequest = {
	operation: 'start',
	host: 'mail.example.test',
	port: 993,
	user: 'test',
	password: 'synthetic',
	mailbox: 'INBOX',
	since: null,
	before: null,
	maxMessages: 1
}
const attachment = (id: string): EmailAttachment => ({
	id,
	path: `/tmp/${id}.pdf`,
	name: `${id}.pdf`,
	bytes: 100,
	subject: 'sample',
	sender: 'sample',
	part: '1',
	observedAt: '2026-09-14T12:00:00.123456+00:00',
	source: { transport: 'imap' }
})
const page = (extra: Partial<EmailResult>): EmailResult => ({
	scope: 'account',
	attachments: [],
	mailboxes: [],
	issues: [],
	snapshotId: 'snapshot',
	total: 150,
	...extra
})

test('whole mailbox automatically advances beyond preview cap, in order, with one intent per PDF', async () => {
	let cursor = 0
	const order: string[] = []
	const state = initialEmailJobState()
	const job = new EmailImportJob(state, {
		accountScope: async () => 'account',
		scan: async (input) => {
			if (input.operation === 'start') return page({ phase: 'indexing', indexed: 150, cursor: 0 })
			expect(input.expectedScope).toBe('account')
			expect(input.cursor).toBe(cursor)
			cursor++
			return page({
				phase: 'importing',
				cursor,
				done: cursor === 150,
				attachments: [attachment(String(cursor))]
			})
		},
		ingest: async (path, environment, context) => {
			expect(context.observedAt).toBe('2026-09-14T12:00:00.123Z')
			expect(environment).toBe('server')
			order.push(path)
			return { intentId: context.intentId }
		}
	})
	await job.startMailbox(request, 'server')
	expect(state.imported).toHaveLength(150)
	expect(new Set(state.imported).size).toBe(150)
	expect(order).toEqual(Array.from({ length: 150 }, (_, i) => `/tmp/${i + 1}.pdf`))
	expect(state.running).toBe(false)
	expect(state.scanned).toBe(150)
})

test('upload failure retains the reason, continues and retries only failed PDFs with stable identity', async () => {
	const state = initialEmailJobState()
	const ids: string[] = []
	let fail = true
	const job = new EmailImportJob(state, {
		accountScope: async () => 'account',
		scan: async () => page({}),
		ingest: async (path, _, context) => {
			if (path.includes('/first.')) {
				ids.push(context.intentId)
				if (fail) throw new Error('ARTIFACT_REQUEST_INVALID: 400')
			}
			return {}
		}
	})
	await job.startSelected(
		page({ attachments: [attachment('first'), attachment('second')] }),
		['first', 'second'],
		'local'
	)
	expect(state.imported).toEqual(['second'])
	expect(state.failed[0].error).toContain('400')
	fail = false
	await job.retryFailed()
	expect(state.imported).toEqual(['second', 'first'])
	expect(state.failed).toHaveLength(0)
	expect(ids[0]).toBe(ids[1])
})

test('pause preserves pending attachments and cursor; resume continues without duplicating', async () => {
	const state = initialEmailJobState()
	const job = new EmailImportJob(state, {
		accountScope: async () => 'account',
		scan: async () => page({}),
		ingest: async (path) => {
			if (path.includes('/first.')) job.pause()
			return {}
		}
	})
	await job.startSelected(
		page({ attachments: [attachment('first'), attachment('second')] }),
		['first', 'second'],
		'local'
	)
	expect(state.paused).toBe(true)
	expect(state.imported).toEqual(['first'])
	await job.resume()
	expect(state.imported).toEqual(['first', 'second'])
})

test('connection loss resumes from same page and rejects an account change', async () => {
	const state = initialEmailJobState()
	let attempt = 0
	const job = new EmailImportJob(state, {
		accountScope: async () => 'account',
		scan: async (input) => {
			if (input.operation === 'start') return page({ cursor: 0 })
			expect(input.cursor).toBe(0)
			if (++attempt === 1) throw new Error('Connection lost')
			return page({ scope: 'different-account', done: true })
		},
		ingest: async () => {
			throw new Error('Must not upload across accounts')
		}
	})
	await job.startMailbox(request, 'local')
	expect(state.error).toBe('Connection lost')
	await job.resume()
	expect(state.error).toContain('account changed')
	expect(state.imported).toHaveLength(0)
})

test('stop during a scan prevents returned attachments from being uploaded', async () => {
	const state = initialEmailJobState()
	const job = new EmailImportJob(state, {
		accountScope: async () => 'account',
		scan: async () => {
			job.cancel()
			return page({ attachments: [attachment('late')], done: true })
		},
		ingest: async () => {
			throw new Error('Unexpected upload')
		}
	})
	await job.startMailbox(request, 'local')
	expect(state.imported).toHaveLength(0)
	expect(state.failed).toHaveLength(0)
	expect(state.running).toBe(false)
})

test('a failed initial mailbox connection stays bound to the starting account on resume', async () => {
	const state = initialEmailJobState()
	let scopeReads = 0
	let scans = 0
	const job = new EmailImportJob(state, {
		accountScope: async () => (++scopeReads === 1 ? 'original-account' : 'another-account'),
		scan: async (input) => {
			expect(input.expectedScope).toBe('original-account')
			scans++
			throw new Error(scans === 1 ? 'Connection lost' : 'Your Aven account changed')
		},
		ingest: async () => {
			throw new Error('Must not import')
		}
	})
	await job.startMailbox(request, 'local')
	await job.resume()
	expect(scopeReads).toBe(1)
	expect(scans).toBe(2)
	expect(state.error).toContain('account changed')
})

test('transient mailbox interruption retries the same cursor automatically', async () => {
	const state = initialEmailJobState()
	let attempts = 0
	const job = new EmailImportJob(state, {
		accountScope: async () => 'account',
		delay: async () => {},
		scan: async (input) => {
			expect(input.operation).toBe('start')
			expect(input.expectedScope).toBe('account')
			if (++attempts < 3) throw new Error('IMAP_RETRYABLE: Connection interrupted')
			return page({ done: true })
		},
		ingest: async () => ({})
	})
	await job.startMailbox(request, 'local')
	expect(attempts).toBe(3)
	expect(state.paused).toBe(false)
	expect(state.error).toBe('')
})
