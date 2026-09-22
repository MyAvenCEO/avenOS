import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { automaticFeedbackCommand, feedbackCommand } from '@avenos/chat-engine/response-feedback'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { retrievalPage } from '../src/retrieval'
import { IntentStore } from '../src/store'

const url = process.env.INTENT_RETRIEVAL_TEST_DATABASE_URL
// Dedicated disposable database only: create a fresh database rather than dropping shared schemas.
const dbName = `retrieval_${randomUUID().replaceAll('-', '')}`
const admin = url ? new pg.Pool({ connectionString: url }) : undefined
let pool: pg.Pool, store: IntentStore
const owner = randomUUID(),
	other = randomUUID(),
	id = randomUUID()
describe.skipIf(!url)('real PostgreSQL retrieval', () => {
	beforeAll(async () => {
		if (!admin || !url) throw Error('Missing isolated test database')
		await admin.query(`CREATE DATABASE ${dbName}`)
		const target = new URL(url)
		target.pathname = `/${dbName}`
		pool = new pg.Pool({
			connectionString: target.toString(),
			options: '-c search_path=aven_intents,public'
		})
		await pool.query('CREATE SCHEMA aven_intents')
		await pool.query(
			await readFile(
				new URL('../../platform-provisioner/components/intents/0001_intents.sql', import.meta.url),
				'utf8'
			)
		)
		store = new IntentStore(pool)
		await store.create(owner, {
			id,
			title: 'Büro Rückerstattung',
			intentType: 'finance',
			sourceLabel: 'Email',
			deadline: null
		})
		for (let n = 0; n < 65; n++)
			await store.append(owner, id, {
				id: randomUUID(),
				contributorKind: n % 2 ? 'agent' : 'human',
				kind: 'message',
				text: `Nachricht ${n} devolución gemeinsame Phrase ${n === 0 ? 'NEEDLE-ALPHA' : ''} ${n === 1 ? 'x'.repeat(15000) : ''}`,
				payload: {}
			})
	}, 30000)
	afterAll(async () => {
		await pool?.end()
		if (admin) {
			await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
			await admin.end()
		}
	})
	test('accent-folded search, original snippets, exact and complete old messages', async () => {
		expect(
			(await store.page(owner, { query: 'buro ruckerstattung' })).intents.map((i) => i.id)
		).toEqual([id])
		const page = await store.messages(owner, { query: 'needle alpha' })
		expect(page.messages).toHaveLength(1)
		expect(page.messages[0].content).toContain('devolución')
		const long = await store.messages(owner, { intent: id, query: 'Nachricht 1' })
		const message = long.messages.find((m) => Number(m.sequence) === 3)
		if (!message) throw Error(JSON.stringify(long))
		const first = await store.message(owner, message.id)
		expect(first.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
		expect(first.content).toHaveLength(12000)
		expect(first.nextOffset).toBe(12000)
		const second = await store.message(owner, message.id, 12000)
		expect(first.content + second.content).toContain('x'.repeat(15000))
		expect(second.nextOffset).toBeNull()
	})
	test('inferred feedback checks owned source provenance, ordering and manual precedence across Intents', async () => {
		const { id } = await store.create(owner, {
			id: randomUUID(),
			title: 'Fictional answer context',
			intentType: 'test',
			sourceLabel: 'Chat',
			deadline: null
		})
		const topic = await store.create(owner, {
			id: randomUUID(),
			title: 'Fictional orchard feedback',
			intentType: 'test',
			sourceLabel: 'Chat',
			deadline: null
		})
		const reply = await store.append(owner, id, {
			id: randomUUID(),
			contributorKind: 'agent',
			kind: 'message',
			text: 'Fictional answer',
			payload: {}
		})
		const source = async (subject = owner) => {
			const reaction = {
				intentId: id,
				responseId: reply.id,
				vote: 'up' as const,
				commandId: randomUUID()
			}
			const sourceId = randomUUID()
			if (subject === owner)
				await store.append(owner, topic.id, {
					id: sourceId,
					contributorKind: 'human',
					kind: 'message',
					text: 'That answer helped. New topic now.',
					payload: {
						feedbackCheck: {
							commandId: reaction.commandId,
							intentId: id,
							locale: 'en-GB',
							recent: [{ role: 'assistant', content: 'Fictional answer', responseId: reply.id }]
						}
					}
				})
			return automaticFeedbackCommand(reaction, sourceId, null, undefined, 'That answer helped')!
		}
		const older = await source(),
			newer = await source()
		await expect(store.append(other, id, newer)).rejects.toThrow('not found')
		await expect(store.append(owner, id, await source(other))).rejects.toThrow('source not found')
		await expect(
			store.append(owner, id, {
				...newer,
				payload: { ...newer.payload, sourceQuote: 'invented evidence' }
			})
		).rejects.toThrow('source not found')
		await store.append(owner, id, newer)
		const auto = (await store.message(owner, reply.id)).feedback
		expect(auto.inferredFrom).toBe(newer.payload.inferredFrom)
		await expect(
			store.append(owner, id, {
				...older,
				payload: { ...older.payload, previousFeedbackId: auto.id }
			})
		).rejects.toThrow('Newer feedback')
		await store.append(owner, id, feedbackCommand(reply.id, null, null, ''))
		const human = (await store.message(owner, reply.id)).feedback
		expect(human.vote).toBeNull()
		expect(human.inferredFrom).toBeUndefined()
		const late = await source()
		await expect(
			store.append(owner, id, {
				...late,
				payload: { ...late.payload, previousFeedbackId: human.id }
			})
		).rejects.toThrow('Manual feedback')
		// A lost acknowledgement retry returns the original receipt without undoing the clear.
		expect((await store.append(owner, id, newer)).id).toBe(newer.id)
		expect((await store.message(owner, reply.id)).feedback.vote).toBeNull()
	})
	test('recent details are bounded while paged history reaches every message once', async () => {
		const detail = await store.detail(owner, id)
		expect(detail.contributions).toHaveLength(40)
		expect(detail.contributionsHasMore).toBe(true)
		const ids: string[] = []
		let cursor: string | undefined
		do {
			const p = await store.messages(owner, { intent: id, limit: 7, cursor })
			ids.push(...p.messages.map((m) => m.id))
			cursor = p.nextCursor ?? undefined
		} while (cursor)
		expect(ids).toHaveLength(65)
		expect(new Set(ids).size).toBe(65)
	})
	test('chronological speaker filters exclude activity and bind every continuation', async () => {
		const first = await store.messages(owner, {
			intent: id,
			role: 'user',
			order: 'oldest',
			limit: 7
		})
		expect(first.messages.map((m) => m.content.match(/^Nachricht (\d+)/)?.[1])).toEqual([
			'0',
			'2',
			'4',
			'6',
			'8',
			'10',
			'12'
		])
		expect(first.ordering).toBe('oldest')
		expect(first.role).toBe('user')
		const second = await store.messages(owner, {
			intent: id,
			role: 'user',
			order: 'oldest',
			limit: 7,
			cursor: first.nextCursor!
		})
		expect(second.messages[0].content).toMatch(/^Nachricht 14 /)
		for (const changed of [{ role: 'assistant' as const }, { order: 'newest' as const }]) {
			await expect(
				store.messages(owner, {
					intent: id,
					role: 'user',
					order: 'oldest',
					cursor: first.nextCursor!,
					...changed
				})
			).rejects.toThrow('Cursor')
		}
		const latest = await store.messages(owner, {
			intent: id,
			role: 'user',
			order: 'newest',
			limit: 1
		})
		expect(latest.messages[0].content).toMatch(/^Nachricht 64 /)
		const found = await store.messages(owner, {
			intent: id,
			query: 'gemeinsame',
			role: 'assistant',
			order: 'oldest',
			limit: 2
		})
		expect(found.messages.map((m) => m.content.match(/Nachricht (\d+)/)?.[1])).toEqual(['1', '3'])
		await expect(store.messages(owner, { order: 'oldest' })).rejects.toThrow('Intent')
		const activity = await store.append(owner, id, {
			id: randomUUID(),
			contributorKind: 'agent',
			kind: 'activity',
			text: 'Fictional maintenance note, not a spoken reply.',
			payload: {}
		})
		const all: string[] = []
		let cursor: string | undefined
		do {
			const page = await store.messages(owner, { intent: id, order: 'oldest', cursor })
			all.push(...page.messages.map((m) => m.id))
			cursor = page.nextCursor ?? undefined
		} while (cursor)
		expect(all).toHaveLength(65)
		expect(new Set(all).size).toBe(65)
		expect(all).not.toContain(activity.id)
	})
	test('search hands off the exact displayed page, including Unicode and stripped-markup fallback', async () => {
		const intent = await store.create(owner, {
			id: randomUUID(),
			title: 'Fictional ceramics workshop',
			intentType: 'test',
			sourceLabel: 'Chat',
			deadline: null
		})
		for (const [query, text] of [
			[
				'kiln checkpoint',
				'🧩 🏺 Ordinary planning notes. '.repeat(1600) +
					'The kiln checkpoint is supervised by Mira at the blue cabinet. End of the workshop notes.'
			],
			['glaze lantern', '🧩 Original <b>glaze lantern</b> notes. '.repeat(900)],
			['ruckgabe', '🏺 Die Rückgabe ist am Dienstag.']
		]) {
			const message = await store.append(owner, intent.id, {
				id: randomUUID(),
				contributorKind: 'human',
				kind: 'message',
				text,
				payload: {}
			})
			const hits = await store.messages(owner, { intent: intent.id, query })
			const hit = hits.messages.find((m) => m.id === message.id)!
			expect(hit).toBeDefined()
			expect(hit.readOffset).toBeGreaterThanOrEqual(0)
			if (query === 'kiln checkpoint') {
				expect(hit.readOffset).toBeGreaterThan(30_000)
				expect(hit.content).toContain('blue cabinet')
			}
			const read = await store.message(owner, hit.id, hit.readOffset)
			expect(read.content.startsWith(hit.content)).toBe(true)
			expect(
				Array.from(text)
					.slice(hit.readOffset, hit.readOffset + 700)
					.join('')
			).toBe(hit.content)
			expect(hit.totalChars).toBe(Array.from(text).length)
			if (Array.from(text).length <= 700) {
				expect(hit.content).toBe(text)
				expect(hit.offset).toBe(0)
			}
			expect(hit.sourceId).toBe(message.id)
			expect(hit.offset).toBe(hit.readOffset)
			const end = hit.offset + Array.from(hit.content).length
			expect(hit.nextOffset).toBe(end < hit.totalChars ? end : null)
			await expect(store.message(other, hit.id, hit.readOffset)).rejects.toThrow('not found')
		}
	})
	test('subject and query-bound cursors never leak another user or context', async () => {
		expect((await store.page(other, { query: 'buro' })).intents).toEqual([])
		expect((await store.messages(other, { intent: id })).messages).toEqual([])
		const p = await store.messages(owner, { intent: id, limit: 2 })
		await expect(
			store.messages(other, { intent: id, cursor: p.nextCursor ?? undefined })
		).rejects.toThrow('Cursor')
		await expect(
			store.messages(owner, { intent: id, query: 'different', cursor: p.nextCursor ?? undefined })
		).rejects.toThrow('Cursor')
		await expect(store.message(other, p.messages[0].id)).rejects.toThrow('not found')
	})
	test('archived messages remain searchable and deleted messages become inaccessible', async () => {
		const x = await store.create(owner, {
			id: randomUUID(),
			title: 'archived probe',
			intentType: 'test',
			sourceLabel: 'Chat',
			deadline: null
		})
		const m = await store.append(owner, x.id, {
			id: randomUUID(),
			contributorKind: 'human',
			kind: 'message',
			text: 'unique tombstone evidence',
			payload: {}
		})
		let d = await store.detail(owner, x.id)
		d = await store.archiveOrRestore(owner, x.id, { id: x.id, expectedVersion: d.version }, false)
		expect((await store.messages(owner, { query: 'tombstone' })).messages).toHaveLength(1)
		await store.tombstone(owner, x.id, { id: x.id, expectedVersion: d.version })
		expect((await store.messages(owner, { query: 'tombstone' })).messages).toEqual([])
		await expect(store.message(owner, m.id)).rejects.toThrow('not found')
	})
	test('keyset retains PostgreSQL microseconds across tied update timestamps', async () => {
		const added = []
		for (let i = 0; i < 4; i++)
			added.push(
				await store.create(owner, {
					id: randomUUID(),
					title: `tie-${i}`,
					intentType: 'test',
					sourceLabel: 'Chat',
					deadline: null
				})
			)
		await pool.query(
			"UPDATE intents SET updated_at='2030-01-01 00:00:00.000123+00' WHERE id=ANY($1::uuid[])",
			[added.map((i) => i.id)]
		)
		let cursor: string | undefined
		const seen: string[] = []
		do {
			const p = await store.page(owner, { limit: 2, cursor })
			seen.push(...p.intents.map((i) => i.id))
			cursor = p.nextCursor ?? undefined
		} while (cursor)
		expect(new Set(seen).size).toBe(seen.length)
		expect(added.every((i) => seen.includes(i.id))).toBe(true)
	})
	test('response feedback is immutable, scoped, replay-safe and projected independently of history paging', async () => {
		const intent = await store.create(owner, {
			id: randomUUID(),
			title: 'Feedback proof',
			intentType: 'test',
			sourceLabel: 'Chat',
			deadline: null
		})
		const reply = await store.append(owner, intent.id, {
			id: randomUUID(),
			contributorKind: 'agent',
			kind: 'message',
			text: 'The original answer remains unchanged.',
			payload: {}
		})
		const command = (
			vote: 'up' | 'down' | null,
			reason: string,
			previousFeedbackId: string | null
		) => ({
			id: randomUUID(),
			contributorKind: 'human' as const,
			kind: 'response-feedback',
			text: null,
			payload: { responseId: reply.id, vote, reason, previousFeedbackId }
		})
		const first = command('down', 'Needs a date.', null)
		const saved = await store.append(owner, intent.id, first)
		expect((await store.append(owner, intent.id, first)).id).toBe(saved.id)
		await expect(store.append(other, intent.id, first)).rejects.toThrow('not found')
		await expect(store.append(owner, id, command('up', '', null))).rejects.toThrow('not found')
		await expect(
			store.append(owner, intent.id, { ...command('up', '', null), contributorKind: 'agent' })
		).rejects.toThrow()
		await expect(
			store.append(owner, intent.id, { ...first, payload: { ...first.payload, vote: 'up' } })
		).rejects.toThrow('conflicts')
		await expect(store.append(owner, intent.id, command('up', '', null))).rejects.toThrow(
			'changed elsewhere'
		)
		const second = command('up', 'Clear after rereading.', saved.id)
		const races = await Promise.allSettled([
			store.append(owner, intent.id, second),
			store.append(owner, intent.id, command('down', 'Other tab', saved.id))
		])
		expect(races.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
		let current = (await store.message(owner, reply.id)).feedback
		expect(current.id).not.toBe(saved.id)
		// A delayed replay returns the old receipt without overwriting the newer vote.
		expect((await store.append(owner, intent.id, first)).id).toBe(saved.id)
		expect((await store.message(owner, reply.id)).feedback).toEqual(current)
		for (let n = 0; n < 45; n++) {
			const updated = await store.append(
				owner,
				intent.id,
				command('up', `Revision ${n}`, current.id)
			)
			current = {
				id: updated.id,
				sequence: updated.sequence,
				vote: 'up',
				reason: `Revision ${n}`,
				updatedAt: updated.createdAt
			}
		}
		const detail = await store.detail(owner, intent.id)
		expect(detail.contributions).toHaveLength(2) // creation + reply, not 47 annotations
		expect(detail.contributionsHasMore).toBe(false)
		expect(detail.contributions.find((c) => c.id === reply.id)?.feedback?.reason).toBe(
			'Revision 44'
		)
		expect((await store.messages(owner, { intent: intent.id })).messages).toHaveLength(1)
		expect((await store.messages(owner, { query: 'Revision' })).messages).toHaveLength(0)
		await expect(store.message(other, reply.id)).rejects.toThrow('not found')
		await expect(store.message(owner, first.id)).rejects.toThrow('not found')
		const clear = await store.append(owner, intent.id, command(null, '', current.id))
		const message = await store.message(owner, reply.id)
		expect(message.feedback).toMatchObject({
			id: clear.id,
			sequence: clear.sequence,
			vote: null,
			reason: ''
		})
		expect(message.content).toBe(reply.text)
		const events = await pool.query(
			"SELECT * FROM contributions WHERE intent_id=$1 AND kind='response-feedback' ORDER BY sequence",
			[intent.id]
		)
		expect(events.rows).toHaveLength(48)
		expect(events.rows[0].payload).toEqual(first.payload)
		expect(events.rows.every((row) => row.owner_subject_id === owner && row.text === null)).toBe(
			true
		)
		const human = await store.append(owner, intent.id, {
			id: randomUUID(),
			contributorKind: 'human',
			kind: 'message',
			text: 'Question',
			payload: {}
		})
		await expect(
			store.append(owner, intent.id, {
				...command('up', '', null),
				payload: { responseId: human.id, vote: 'up', reason: '', previousFeedbackId: null }
			})
		).rejects.toThrow('not found')
		// Merge provenance retains original contributions in the source Intent.
		const target = await store.create(owner, {
			id: randomUUID(),
			title: 'Merged feedback',
			intentType: 'test',
			sourceLabel: 'Chat',
			deadline: null
		})
		const before = await store.detail(owner, intent.id)
		await store.merge(owner, target.id, {
			id: target.id,
			expectedVersion: target.version,
			commandId: randomUUID(),
			sources: [{ id: intent.id, expectedVersion: before.version }]
		})
		expect(
			(await store.detail(owner, intent.id)).contributions.find((c) => c.id === reply.id)?.feedback
				?.id
		).toBe(clear.id)
		await expect(store.append(owner, intent.id, command('up', '', clear.id))).rejects.toThrow(
			'not found'
		)
	})
})
test('malformed and cross-subject cursors reject before querying', () => {
	const page = retrievalPage(owner, {}, 'intents'),
		cursor = page.cursor({ id })
	expect(() => retrievalPage(other, { cursor }, 'intents')).toThrow()
	for (const invalid of ['!', Buffer.from('null').toString('base64url'), 'x'.repeat(3000)])
		expect(() => retrievalPage(owner, { cursor: invalid }, 'intents')).toThrow()
})
