import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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
})
test('malformed and cross-subject cursors reject before querying', () => {
	const page = retrievalPage(owner, {}, 'intents'),
		cursor = page.cursor({ id })
	expect(() => retrievalPage(other, { cursor }, 'intents')).toThrow()
	for (const invalid of ['!', Buffer.from('null').toString('base64url'), 'x'.repeat(3000)])
		expect(() => retrievalPage(owner, { cursor: invalid }, 'intents')).toThrow()
})
