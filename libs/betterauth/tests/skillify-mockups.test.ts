import { afterAll, describe, expect, test } from 'bun:test'
import { TOOL_ACTORS } from '@avenos/skills/tools'
import { sql } from 'kysely'
import { advertisedTools, chatToolDefinitionsFor, skillMenu } from '../src/config'
import { db } from '../src/db'
import { composeFlows } from '../src/flows'
import { listMockups, MOCK_PREFIX, mockName, saveMockup } from '../src/mockup-caps'
import { loadVibe } from '../src/vibe-registry'

// board 0115 — SKILLIFY part 1: designing a skill screen in chat is pure config behind hard gates. These
// tests prove (a) the skill is wired from the DB (router menu · tools · read-model), (b) saveMockup's
// three gates + the mock- NAMESPACE WALL (GLM can never overwrite system vibes), (c) the no-LLM viewer
// actor, (d) the GLM authoring prompt is DB config.

async function hasDb(): Promise<boolean> {
	try {
		await sql`SELECT 1`.execute(db())
		return true
	} catch {
		return false
	}
}
const DB = await hasDb()
const d = DB ? describe : describe.skip

const VALID_VIEW = {
	content: {
		class: 'bk-root',
		children: [
			{ tag: 'h2', class: 'bk-title', text: '$title' },
			{
				class: 'bk-grid',
				children: [
					{ $each: { items: '$accounts', template: { class: 'grid-card', children: [{ text: '$$name', class: 'grid-card-title' }, { text: '$$balance', class: 'bk-balance' }] } } }
				]
			}
		]
	}
}
const VALID_STYLE = {
	tokens: {},
	selectors: {
		'.bk-root': { display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' },
		'.bk-grid': { display: 'grid', width: '100%', gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))', gap: '0.75rem' },
		'.bk-balance': { fontVariantNumeric: 'tabular-nums', color: 'var(--brand-accent)' }
	}
}
const VALID_SOURCE = {
	title: 'Konten',
	accounts: [
		{ name: 'Girokonto', balance: '€ 2.340' },
		{ name: 'Tagesgeld', balance: '€ 12.000' }
	]
}

d('board 0115 — skillify mockups: wiring, gates, the mock- wall, the viewer', () => {
	test('(a) the skillify skill is wired from the DB: menu · tools · read-model', async () => {
		const menu = await skillMenu()
		expect(menu.some((s) => s.id === 'skillify')).toBe(true)
		expect(await advertisedTools('skillify')).toEqual(['create_mockup', 'edit_mockup', 'mockups'])
		expect((await chatToolDefinitionsFor('skillify')).map((x) => x.function.name)).toEqual([
			'create_mockup',
			'edit_mockup',
			'mockups'
		])
		const flow = (await composeFlows()).find((f) => f.id === 'skillify')
		expect((flow?.nodes as { id: string }[]).map((n) => n.id)).toEqual([
			'create_mockup',
			'edit_mockup',
			'mockups'
		])
	})

	test('(b) the mock- WALL: input name "todos" saves as mock-todos; the system rows are untouched', async () => {
		const before = await sql<{ body: unknown }>`SELECT body FROM vibe_view WHERE name = 'todos'`.execute(db())
		const name = await saveMockup('todos', { view: VALID_VIEW, style: VALID_STYLE, source: VALID_SOURCE })
		expect(name).toBe(`${MOCK_PREFIX}todos`)
		const after = await sql<{ body: unknown }>`SELECT body FROM vibe_view WHERE name = 'todos'`.execute(db())
		expect(JSON.stringify(after.rows[0].body)).toBe(JSON.stringify(before.rows[0].body))
		expect(mockName('Mock Banking Accounts!')).toBe('mock-banking-accounts')
	})

	test('(b) the gates reject: forbidden style prop · forbidden view tag · empty source', async () => {
		await expect(
			saveMockup('bad-style', {
				view: VALID_VIEW,
				style: { tokens: {}, selectors: { '.x': { position: 'fixed' } } },
				source: VALID_SOURCE
			})
		).rejects.toThrow()
		await expect(
			saveMockup('bad-view', {
				view: { content: { tag: 'script', text: 'x' } },
				style: VALID_STYLE,
				source: VALID_SOURCE
			})
		).rejects.toThrow()
		await expect(
			saveMockup('bad-source', { view: VALID_VIEW, style: VALID_STYLE, source: {} })
		).rejects.toThrow()
	})

	test('(b) the COVERAGE gate: a view key the source misses is rejected BY NAME', async () => {
		// the live finding: an empty GESAMTSALDO card — the view read $balance, the source lacked it.
		await expect(
			saveMockup('bad-coverage', {
				view: {
					content: {
						class: 'r',
						children: [
							{ text: '$balance', class: 'b' },
							{ class: 'g', children: [{ $each: { items: '$rows', template: { text: '$$label', class: 'l' } } }] }
						]
					}
				},
				style: VALID_STYLE,
				source: { rows: [{ notLabel: 'x' }] } // balance missing entirely; rows items miss `label`
			})
		).rejects.toThrow(/\$balance.*\$\$label|\$\$label.*\$balance/s)
	})

	test('(b) a valid mockup lands as 4 rows and the bundle serves its example source', async () => {
		const name = await saveMockup('banking-accounts', {
			view: VALID_VIEW,
			style: VALID_STYLE,
			source: VALID_SOURCE
		})
		const bundle = await loadVibe(name)
		expect(bundle?.view).toBeTruthy()
		expect(bundle?.logic).toContain('initState') // the identity mapper
		expect((bundle?.source as { accounts?: unknown[] })?.accounts?.length).toBe(2)
		// the composed style carries the brand layer underneath the mockup's own selectors.
		expect(JSON.stringify(bundle?.style)).toContain('grid-card')
	})

	test('(c) the mockups VIEWER (no LLM): lists minted mockups; shows one by fuzzy name', async () => {
		const ctx = {
			userId: 'u1',
			data: async () => ({}),
			mockup: {
				mint: async () => ({ error: 'not used' }),
				list: listMockups,
				load: (n: string) => loadVibe(mockName(n))
			}
		}
		// edit_mockup fails HONESTLY on an unknown name, carrying the available labels.
		const miss = (await TOOL_ACTORS.edit_mockup.handle(ctx as never, {
			name: 'does-not-exist',
			description: 'bigger'
		})) as { content: { ok?: boolean; available?: string[] } }
		expect(miss.content.ok).toBe(false)
		expect(Array.isArray(miss.content.available)).toBe(true)
		const list = (await TOOL_ACTORS.mockups.handle(ctx as never, {})) as {
			content: { mockups?: { name: string }[] }
			vibe?: { schema: string }
		}
		expect(list.vibe?.schema).toBe('mockups')
		expect(list.content.mockups?.some((m) => m.name === 'mock-banking-accounts')).toBe(true)
		const show = (await TOOL_ACTORS.mockups.handle(ctx as never, { name: 'banking accounts' })) as {
			vibe?: { schema: string; data?: unknown }
		}
		expect(show.vibe?.schema).toBe('mock-banking-accounts')
		expect(show.vibe && 'data' in show.vibe ? show.vibe.data : undefined).toBeUndefined()
	})

	test('(d) the GLM authoring prompt is DB config on the mockup actor row', async () => {
		for (const actor of ['create_mockup', 'edit_mockup']) {
			const r = await sql<{ prompt: string | null }>`
				SELECT prompt FROM actor WHERE skill_id = 'skillify' AND name = ${actor}
			`.execute(db())
			expect((r.rows[0]?.prompt ?? '').length).toBeGreaterThan(200)
			expect(r.rows[0]?.prompt).toContain('VIEW grammar')
		}
	})

	afterAll(async () => {
		if (!DB) return
		for (const t of ['vibe_view', 'vibe_style', 'vibe_logic', 'vibe_source'])
			await sql`DELETE FROM ${sql.raw(t)} WHERE name IN ('mock-todos', 'mock-banking-accounts')`.execute(db())
	})
})
