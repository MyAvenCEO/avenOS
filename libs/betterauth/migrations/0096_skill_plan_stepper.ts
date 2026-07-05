import { type Kysely, sql } from 'kysely'

// board 0113 — the skill-plan card REDESIGNED as a pipeline STEPPER (Samuel: "not very clear what it's
// all about" + "the mockup step should be step one"). The card now tells the whole journey:
//   ① Design ✓ → ② Plan (you are here) → ③ Daten → ④ Aktoren → ⑤ Seed → ⑥ Live
// with done/current/pending states, a per-step hint line, the entity tiles with field CHIPS + seed
// count, and the computed-values row marked ƒ (live-berechnet, nicht gespeichert). Pure config.

const VIEW = {
	content: {
		class: 'sp-root',
		children: [
			{
				class: 'sp-eyebrow',
				children: [{ text: 'Skillify' }, { text: 'Promotion', class: 'sp-eyebrow-sub' }]
			},
			{ tag: 'h2', class: 'sp-title', text: '$app' },
			{
				class: 'sp-steps',
				children: [
					{
						$each: {
							items: '$steps',
							template: {
								class: 'sp-step',
								attrs: { 'data-state': '$$state' },
								children: [
									{ class: 'sp-step-dot', text: '$$mark' },
									{ text: '$$label', class: 'sp-step-label' }
								]
							}
						}
					}
				]
			},
			{ text: '$hint', class: 'sp-hint' },
			{ text: '$entityHeading', class: 'sp-section' },
			{
				class: 'sp-grid',
				children: [
					{
						$each: {
							items: '$entities',
							template: {
								class: 'grid-card',
								children: [
									{ text: '$$type', class: 'grid-card-title' },
									{ text: '$$fieldsLabel', class: 'sp-fields' },
									{ text: '$$seedLabel', class: 'sp-seed' }
								]
							}
						}
					}
				]
			},
			{ text: '$aggLabel', class: 'sp-agg' }
		]
	}
}

const LOGIC = `function initState(source){source=source||{};
var stepKey=String(source.step||'plan');
var idx=stepKey==='plan'?1:(stepKey==='data'?2:(stepKey==='wired'?4:(stepKey==='live'?6:1)));
var labels=['Design','Plan','Daten','Aktoren','Seed','Live'];
var steps=[];
for(var i=0;i<labels.length;i++){
	var st=i<idx?'done':(i===idx?'current':'pending');
	steps.push({label:labels[i],state:st,mark:i<idx?'\\u2713':String(i+1)});
}
var hints={
	plan:'Noch nichts erstellt \\u2014 dieser Plan ist ein Vorschlag aus deinen Beispieldaten. Sag \\u201eweiter\\u201c, um die Datenschicht zu bauen, oder \\u00e4ndere ihn (z.\\u2009B. Feld entfernen, Typ umbenennen).',
	wired:'Skill + Sandbox-Aktor sind verdrahtet (Code-Testlauf bestanden). Als N\\u00e4chstes: Beispieldaten einspielen \\u2014 oder \\u00fcberspringen und direkt promoten.',
	live:'Die App ist live \\u2014 echte Daten, gleiche Karte.'
};
var es=source.entities||[];var out=[];
for(var j=0;j<es.length;j++){var e=es[j]||{};
	out.push({type:String(e.type||'\\u2014'),
		fieldsLabel:(e.fields||[]).join('  \\u00b7  '),
		seedLabel:(e.seedRows||0)>0?((e.seedRows)+' Beispielzeilen als Startdaten'):''});
}
var ag=source.aggregates||[];
return{app:String(source.app||'\\u2014'),steps:steps,
	hint:hints[stepKey]||hints.plan,
	entityHeading:out.length?'Was gespeichert wird':'',
	entities:out,
	aggLabel:ag.length?('\\u0192 Live berechnet (nicht gespeichert): '+ag.join(', ')):''};}
function handleEvent(t, p, s) { return s }`

const STYLE = {
	extends: 'brand',
	tokens: {},
	selectors: {
		'.sp-root': {
			display: 'flex',
			flexDirection: 'column',
			gap: '0.7rem',
			width: '100%',
			fontFamily: 'var(--font-sans)',
			color: 'var(--text)',
			letterSpacing: '-0.02em'
		},
		'.sp-eyebrow': {
			display: 'inline-flex',
			alignItems: 'center',
			gap: '0.45rem',
			fontSize: 'var(--fs-micro)',
			fontWeight: '600',
			letterSpacing: '0.09em',
			textTransform: 'uppercase',
			color: 'var(--muted)'
		},
		'.sp-eyebrow::before': { content: '"◆"', color: 'var(--brand-accent)', fontSize: '0.85em' },
		'.sp-eyebrow-sub': { color: 'var(--brand-accent)', opacity: '0.85' },
		'.sp-title': {
			fontFamily: 'var(--font-display)',
			fontSize: 'var(--fs-title)',
			fontWeight: '500',
			margin: '0'
		},
		// the STEPPER: six pills with connectors; state via data-state.
		'.sp-steps': {
			display: 'flex',
			alignItems: 'center',
			flexWrap: 'wrap',
			gap: '0.35rem',
			padding: '0.55rem 0.7rem',
			background: 'var(--surface)',
			border: '1px solid var(--border)',
			borderRadius: 'var(--radius-card)'
		},
		'.sp-step': { display: 'inline-flex', alignItems: 'center', gap: '0.35rem' },
		'.sp-step::after': { content: '"→"', color: 'var(--muted)', opacity: '0.35', margin: '0 0.15rem' },
		'.sp-step:last-child::after': { content: '""', margin: '0' },
		'.sp-step-dot': {
			display: 'inline-flex',
			alignItems: 'center',
			justifyContent: 'center',
			width: '1.15rem',
			height: '1.15rem',
			borderRadius: 'var(--radius-pill)',
			fontSize: '0.62rem',
			fontWeight: '700',
			border: '1px solid var(--border)',
			color: 'var(--muted)'
		},
		'.sp-step-label': { fontSize: 'var(--fs-micro)', color: 'var(--muted)' },
		'.sp-step[data-state="done"] .sp-step-dot': {
			background: 'var(--primary)',
			color: 'var(--primary-foreground)',
			border: '1px solid var(--primary)'
		},
		'.sp-step[data-state="done"] .sp-step-label': { color: 'var(--text)' },
		'.sp-step[data-state="current"] .sp-step-dot': {
			border: '2px solid var(--brand-accent)',
			color: 'var(--brand-accent)'
		},
		'.sp-step[data-state="current"] .sp-step-label': { color: 'var(--brand-accent)', fontWeight: '700' },
		'.sp-hint': {
			fontSize: 'var(--fs-body)',
			lineHeight: '1.5',
			color: 'var(--muted-strong)',
			background: 'color-mix(in srgb, var(--brand-accent) 6%, transparent)',
			border: '1px solid color-mix(in srgb, var(--brand-accent) 18%, transparent)',
			borderRadius: 'var(--radius-card)',
			padding: '0.6rem 0.85rem'
		},
		'.sp-hint:empty': { display: 'none' },
		'.sp-section': {
			fontSize: 'var(--fs-micro)',
			fontWeight: '600',
			letterSpacing: '0.08em',
			textTransform: 'uppercase',
			color: 'var(--muted)'
		},
		'.sp-section:empty': { display: 'none' },
		'.sp-grid': {
			display: 'grid',
			width: '100%',
			gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))',
			gap: '0.75rem'
		},
		'.sp-fields': {
			fontSize: 'var(--fs-micro)',
			fontFamily: 'var(--font-sans)',
			color: 'var(--muted-strong)',
			background: 'var(--surface)',
			border: '1px solid var(--border)',
			borderRadius: 'var(--radius-pill)',
			padding: '0.2rem 0.6rem'
		},
		'.sp-seed': { fontSize: 'var(--fs-micro)', color: 'var(--brand-accent)', fontWeight: '600' },
		'.sp-seed:empty': { display: 'none' },
		'.sp-agg': { fontSize: 'var(--fs-micro)', color: 'var(--muted)' },
		'.sp-agg:empty': { display: 'none' }
	}
}

const SOURCE = {
	app: 'banking-overview',
	step: 'plan',
	entities: [{ type: 'transaction', fields: ['date', 'name', 'amount', 'category'], seedRows: 5 }],
	aggregates: ['totalBalance']
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`INSERT INTO vibe_view (name, body) VALUES ('skill-plan', ${JSON.stringify(VIEW)}::jsonb) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
	await sql`INSERT INTO vibe_style (name, body) VALUES ('skill-plan', ${JSON.stringify(STYLE)}::jsonb) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
	await sql`INSERT INTO vibe_logic (name, body) VALUES ('skill-plan', ${LOGIC}) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
	await sql`INSERT INTO vibe_source (name, body) VALUES ('skill-plan', ${JSON.stringify(SOURCE)}::jsonb) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`.execute(db)
}

export async function down(): Promise<void> {
	// re-run 0094 to restore the previous card.
}
