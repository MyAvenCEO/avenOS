import { withBrand } from '@avenos/aven-vibes'
import { type Kysely, sql } from 'kysely'
import { MOCKUP_INSTRUCTIONS } from '../src/mockup-caps'

// board 0115 — the SKILLIFY skill (part 1: vibe mockups) as pure config: the skill row (router menu),
// the `mockup` actor (GLM designs/refines a screen — prompt-as-config, the 0112 pattern) + the `mockups`
// actor (no-LLM show/list), and the `mockups` LIST vibe (the grid of minted mockups). Everything else —
// dispatch visibility, tracing, previews — comes free from 0114.

const MOCKUP_ACTOR_ID = '00000000-0000-0000-0000-0000000115a1'
const MOCKUPS_ACTOR_ID = '00000000-0000-0000-0000-0000000115a2'

const MOCKUP_MAILBOX = {
	description:
		'DESIGN or REFINE a screen mockup for a new skill feature (look only — view, style, example data; ' +
		'no real data). Use when the user wants to design/mock/sketch a new screen or change how an ' +
		'existing MOCKUP looks ("make the total bigger"). Pass `name` when refining a known mockup.',
	parameters: {
		type: 'object',
		properties: {
			description: {
				type: 'string',
				description:
					'What the screen should show, in the user\'s words (e.g. "banking accounts with balances and a total").'
			},
			name: {
				type: 'string',
				description: 'Refine THIS existing mockup (its kebab-case name); omit when creating new.'
			},
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		},
		required: ['description']
	}
}
const MOCKUPS_MAILBOX = {
	description:
		'SHOW existing screen mockups (no designing): pass `name` to render ONE mockup card ("show me the ' +
		'banking screen"), or omit it to list ALL minted mockups as a grid. Instant — never use this to ' +
		'create or change a mockup (that is the `mockup` tool).',
	parameters: {
		type: 'object',
		properties: {
			name: { type: 'string', description: 'The mockup to show (kebab-case or plain words).' },
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		}
	}
}

// ── the `mockups` LIST vibe (system row, not mock- prefixed): a brand grid of minted mockups ─────────
const MOCKUPS_VIEW = {
	content: {
		class: 'mk-root',
		children: [
			{
				class: 'mk-eyebrow',
				children: [{ text: 'Mockups' }, { text: '$count', class: 'mk-meta' }]
			},
			{ text: '$emptyMsg', class: 'mk-empty' },
			{
				class: 'mk-grid',
				children: [
					{
						$each: {
							items: '$items',
							template: {
								class: 'grid-card',
								children: [
									{ text: '$$label', class: 'grid-card-title' },
									{ text: '$$name', class: 'mk-name' }
								]
							}
						}
					}
				]
			}
		]
	}
}
const MOCKUPS_LOGIC = `function initState(source){source=source||{};var ms=source.mockups||[];var out=[];for(var i=0;i<ms.length;i++){var m=ms[i]||{};out.push({name:String(m.name||''),label:String(m.label||m.name||'\\u2014')});}return{count:out.length+' Entw\\u00fcrfe',items:out,emptyMsg:out.length?'':'Noch keine Mockups \\u2014 sag mir, welchen Screen ich entwerfen soll.'};}
function handleEvent(t, p, s) { return s }`
const MOCKUPS_STYLE = withBrand({
	tokens: {},
	selectors: {
		'.mk-root': {
			display: 'flex',
			flexDirection: 'column',
			gap: '0.55rem',
			width: '100%',
			fontFamily: 'var(--font-sans)',
			color: 'var(--text)',
			letterSpacing: '-0.02em'
		},
		'.mk-eyebrow': {
			display: 'inline-flex',
			alignItems: 'center',
			gap: '0.4rem',
			fontSize: 'var(--fs-micro)',
			fontWeight: '600',
			letterSpacing: '0.09em',
			textTransform: 'uppercase',
			color: 'var(--muted)'
		},
		'.mk-eyebrow::before': { content: '"◇"', color: 'var(--brand-accent)', fontSize: '0.9em' },
		'.mk-meta': { fontSize: 'var(--fs-micro)', color: 'var(--muted)', opacity: '0.7' },
		'.mk-grid': {
			display: 'grid',
			width: '100%',
			gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))',
			gap: '0.75rem'
		},
		'.mk-name': { fontSize: 'var(--fs-micro)', color: 'var(--muted)', fontFamily: 'var(--font-sans)' },
		'.mk-empty': {
			border: '1px dashed var(--border)',
			borderRadius: 'var(--radius-card)',
			padding: '1.1rem 1.25rem',
			textAlign: 'center',
			fontSize: 'var(--fs-body)',
			color: 'var(--muted)'
		},
		'.mk-empty:empty': { display: 'none' }
	}
})
const MOCKUPS_SOURCE = {
	mockups: [
		{ name: 'mock-banking-accounts', label: 'banking accounts' },
		{ name: 'mock-reading-list', label: 'reading list' }
	]
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO skill (id, label, description, position, created_at, updated_at)
		VALUES ('skillify', 'Skillify',
			${'design, refine, or show SCREEN MOCKUPS for new skill features ("design me a banking screen", "make the total bigger", "show me my mockups") — look only, no real data yet'},
			5, now(), now())
		ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, updated_at = now()
	`.execute(db)
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, prompt, hitl, position, created_at, updated_at)
		VALUES (${MOCKUP_ACTOR_ID}, 'skillify', 'mockup', 'mockup', ${JSON.stringify(MOCKUP_MAILBOX)}::jsonb, ${MOCKUP_INSTRUCTIONS}, false, 1, now(), now())
		ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, prompt = EXCLUDED.prompt, updated_at = now()
	`.execute(db)
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, vibe, hitl, position, created_at, updated_at)
		VALUES (${MOCKUPS_ACTOR_ID}, 'skillify', 'mockups', 'mockups', ${JSON.stringify(MOCKUPS_MAILBOX)}::jsonb, 'mockups', false, 2, now(), now())
		ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, vibe = EXCLUDED.vibe, updated_at = now()
	`.execute(db)
	await sql`INSERT INTO vibe_view (name, body) VALUES ('mockups', ${JSON.stringify(MOCKUPS_VIEW)}::jsonb) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
	await sql`INSERT INTO vibe_style (name, body) VALUES ('mockups', ${JSON.stringify(MOCKUPS_STYLE)}::jsonb) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
	await sql`INSERT INTO vibe_logic (name, body) VALUES ('mockups', ${MOCKUPS_LOGIC}) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
	await sql`INSERT INTO vibe_source (name, body) VALUES ('mockups', ${JSON.stringify(MOCKUPS_SOURCE)}::jsonb) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM actor WHERE id IN (${MOCKUP_ACTOR_ID}, ${MOCKUPS_ACTOR_ID})`.execute(db)
	await sql`DELETE FROM skill WHERE id = 'skillify'`.execute(db)
	for (const t of ['vibe_view', 'vibe_style', 'vibe_logic', 'vibe_source'])
		await sql`DELETE FROM ${sql.raw(t)} WHERE name = 'mockups'`.execute(db)
}
