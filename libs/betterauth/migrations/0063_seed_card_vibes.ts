import { type Kysely, sql } from 'kysely'

// board 0105 — every chat/Runs card as config-as-data. Seed vibe_view/style/logic rows for the 8 card kinds
// that were hardcoded Svelte (ontology read/created, query/mutation results, bundle-created, todos
// created/edited/deleted). They render through the SAME engine (AvenVibeView + QuickJS) via the generic
// VibeCard host; the card's `vibeData` is the vibe `source`. All views use ONLY single-level `$each` (the
// proven todos pattern) — any nesting is flattened to a string in `initState`, so no unverified engine paths.

// One shared style for all cards (each name needs its own vibe_style row; they share this body). camelCase CSS.
const STYLE = {
	tokens: {
		ink: '#1f2a3d',
		muted: 'rgba(31,42,61,0.56)',
		border: 'rgba(31,42,61,0.14)',
		card: 'rgba(255,255,255,0.5)',
		green: '#2e7d52',
		red: '#c15b40',
		amber: '#b8863b',
		radius: '0.75rem',
		'font-sans': "'Chillax', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
		'font-mono': "'JetBrains Mono', ui-monospace, Menlo, monospace"
	},
	selectors: {
		'.vc-root': {
			display: 'flex',
			flexDirection: 'column',
			gap: '0.5rem',
			fontFamily: 'var(--font-sans)',
			color: 'var(--ink)'
		},
		'.vc-header': { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' },
		'.vc-dot': {
			width: '0.5rem',
			height: '0.5rem',
			borderRadius: '9999px',
			background: 'var(--ink)',
			flexShrink: '0'
		},
		'.vc-dot--green': { background: 'var(--green)' },
		'.vc-dot--amber': { background: 'var(--amber)' },
		'.vc-dot--red': { background: 'var(--red)' },
		'.vc-eyebrow': {
			fontSize: '11px',
			fontWeight: '700',
			letterSpacing: '0.14em',
			textTransform: 'uppercase'
		},
		'.vc-eyebrow--green': { color: 'var(--green)' },
		'.vc-eyebrow--red': { color: 'var(--red)' },
		'.vc-eyebrow--amber': { color: 'var(--amber)' },
		'.vc-title': { fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: '600' },
		'.vc-meta': { fontSize: '11px', color: 'var(--muted)' },
		// board 0105 — the engine's CSS allow-list (style-validator) forbids fontStyle; the request reads fine
		// as muted text without italics (security: use only allow-listed properties, never widen the list).
		'.vc-request': {
			fontSize: '13px',
			color: 'var(--muted)',
			margin: '0.25rem 0 0.5rem'
		},
		'.vc-request:empty': { display: 'none' },
		'.vc-card': {
			border: '1px solid var(--border)',
			background: 'var(--card)',
			borderRadius: 'var(--radius)',
			padding: '1rem'
		},
		'.vc-label': {
			fontSize: '10px',
			fontWeight: '600',
			letterSpacing: '0.08em',
			textTransform: 'uppercase',
			color: 'var(--muted)',
			marginBottom: '0.375rem'
		},
		'.vc-label--mt': { marginTop: '0.75rem' },
		'.vc-list': {
			display: 'flex',
			flexDirection: 'column',
			gap: '0.5rem',
			listStyle: 'none',
			margin: '0',
			padding: '0'
		},
		'.vc-row': {
			display: 'flex',
			alignItems: 'baseline',
			gap: '0.625rem',
			border: '1px solid var(--border)',
			background: 'var(--card)',
			borderRadius: 'var(--radius)',
			padding: '0.625rem 1rem',
			fontSize: '13px'
		},
		'.vc-pred': {
			fontFamily: 'var(--font-mono)',
			fontSize: '13px',
			fontWeight: '500',
			flexShrink: '0'
		},
		'.vc-gismu': { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--muted)' },
		'.vc-kind': {
			fontSize: '10px',
			background: 'rgba(31,42,61,0.08)',
			color: 'var(--muted)',
			borderRadius: '9999px',
			padding: '0.1rem 0.4rem',
			flexShrink: '0'
		},
		'.vc-field': { fontSize: '12px', color: 'var(--muted)' },
		'.vc-crow': { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' },
		'.vc-places-text': {
			fontFamily: 'var(--font-mono)',
			fontSize: '11px',
			color: 'var(--muted)',
			marginTop: '0.25rem'
		},
		'.vc-chips': { display: 'flex', flexWrap: 'wrap', gap: '0.375rem' },
		'.vc-chip': {
			display: 'inline-flex',
			gap: '0.25rem',
			border: '1px solid var(--border)',
			borderRadius: '9999px',
			padding: '0.1rem 0.5rem',
			fontSize: '11px'
		},
		'.vc-chip-k': { fontWeight: '500' },
		'.vc-chip-v': { fontFamily: 'var(--font-mono)', color: 'var(--muted)' },
		'.vc-minted': { fontSize: '12px', color: 'var(--muted)', marginTop: '0.5rem' },
		'.vc-minted:empty': { display: 'none' },
		'.vc-empty': {
			border: '1px dashed var(--border)',
			borderRadius: 'var(--radius)',
			padding: '1.25rem',
			textAlign: 'center',
			fontSize: '13px',
			color: 'var(--muted)'
		},
		'.vc-empty:empty': { display: 'none' },
		'.vc-reused': { color: 'var(--muted)' },
		'.vc-op': {
			fontSize: '10px',
			fontWeight: '600',
			borderRadius: '9999px',
			padding: '0.1rem 0.4rem',
			flexShrink: '0'
		},
		'.vc-op--insert': { background: 'rgba(46,125,82,0.15)', color: 'var(--green)' },
		'.vc-op--delete': { background: 'rgba(193,91,64,0.15)', color: 'var(--red)' },
		'.vc-strike': { textDecoration: 'line-through', color: 'var(--muted)' },
		'.vc-line': { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--ink)' }
	}
}

// A read-only card fires no events; a no-op handleEvent keeps the QuickJS contract satisfied.
const NOOP = '\nfunction handleEvent(t, p, s) { return s }\n'

type Card = { view: Record<string, unknown>; logic: string }
const CARDS: Record<string, Card> = {
	'bundle-created': {
		view: {
			content: {
				class: 'vc-root',
				children: [
					{
						class: 'vc-header',
						children: [
							{ class: 'vc-dot vc-dot--green' },
							{ text: 'Neuer Typ', class: 'vc-eyebrow vc-eyebrow--green' },
							{ text: '$type', class: 'vc-title' },
							{ text: '$meta', class: 'vc-meta' }
						]
					},
					{ text: '$request', class: 'vc-request' },
					{
						class: 'vc-card',
						children: [
							{ text: 'Traits', class: 'vc-label' },
							{
								tag: 'ul',
								class: 'vc-list',
								children: [
									{
										$each: {
											items: '$traits',
											template: {
												tag: 'li',
												class: 'vc-row',
												children: [
													{ text: '$$pred', class: 'vc-pred' },
													{ text: '$$kind', class: 'vc-kind' },
													{ text: '$$field', class: 'vc-field' }
												]
											}
										}
									}
								]
							},
							{ text: 'View', class: 'vc-label vc-label--mt' },
							{
								class: 'vc-chips',
								children: [
									{
										$each: {
											items: '$view',
											template: {
												class: 'vc-chip',
												children: [
													{ text: '$$field', class: 'vc-chip-k' },
													{ text: '$$read', class: 'vc-chip-v' }
												]
											}
										}
									}
								]
							}
						]
					},
					{ text: '$minted', class: 'vc-minted' }
				]
			}
		},
		logic: `function initState(source){source=source||{};var spec=source.spec||{};var parts=spec.parts||[];var project=spec.project||{};var traits=[];for(var i=0;i<parts.length;i++){var p=parts[i];traits.push({pred:p.pred||'',kind:p.kind||'',field:p.field?('\\u2190 '+p.field):''});}var view=[];var ks=Object.keys(project);for(var j=0;j<ks.length;j++){var f=ks[j];var pj=project[f]||{};var r=pj.notNull?(pj.pred+'.'+pj.notNull+' ?'):(pj.children?(pj.pred+'[]'):(pj.pred+'.'+(pj.place||'?')));view.push({field:f,read:'= '+r});}var m=source.mintedPredicates||[];return{type:spec.type||'\\u2014',request:source.request?('\\u201e'+source.request+'\\u201c'):'',meta:traits.length+' Traits \\u00b7 '+view.length+' Felder',traits:traits,view:view,minted:m.length?('+ '+m.length+' Pr\\u00e4dikat(e): '+m.join(', ')):''};}${NOOP}`
	},
	ontology: {
		view: {
			content: {
				class: 'vc-root',
				children: [
					{
						class: 'vc-header',
						children: [
							{ class: 'vc-dot' },
							{ text: 'Ontologie', class: 'vc-eyebrow' },
							{ text: '$count', class: 'vc-meta' }
						]
					},
					{ text: '$emptyMsg', class: 'vc-empty' },
					{
						tag: 'ul',
						class: 'vc-list',
						children: [
							{
								$each: {
									items: '$predicates',
									template: {
										tag: 'li',
										class: 'vc-row',
										children: [
											{ text: '$$name', class: 'vc-pred' },
											{ text: '$$gloss', class: 'vc-field' }
										]
									}
								}
							}
						]
					}
				]
			}
		},
		logic: `function initState(source){source=source||{};var ps=source.predicates||[];var out=[];for(var i=0;i<ps.length;i++){out.push({name:ps[i].name||'',gloss:ps[i].gloss||''});}return{count:out.length+' Pr\\u00e4dikate',predicates:out,emptyMsg:out.length?'':'Noch keine Beziehungstypen \\u2014 beschreibe eine, um sie anzulegen.'};}${NOOP}`
	},
	'ontology-created': {
		view: {
			content: {
				class: 'vc-root',
				children: [
					{
						class: 'vc-header',
						children: [
							{ class: 'vc-dot vc-dot--green' },
							{ text: '$header', class: 'vc-eyebrow vc-eyebrow--green' }
						]
					},
					{
						tag: 'ul',
						class: 'vc-list',
						children: [
							{
								$each: {
									items: '$created',
									template: {
										tag: 'li',
										class: 'vc-card',
										children: [
											{
												class: 'vc-crow',
												children: [
													{ text: '$$predicate', class: 'vc-pred' },
													{ text: '$$gismu', class: 'vc-gismu' },
													{ text: '$$placeCount', class: 'vc-meta' }
												]
											},
											{ text: '$$gloss', class: 'vc-field' },
											{ text: '$$placesText', class: 'vc-places-text' }
										]
									}
								}
							}
						]
					},
					{
						tag: 'ul',
						class: 'vc-list',
						children: [
							{
								$each: {
									items: '$reused',
									template: {
										tag: 'li',
										class: 'vc-row vc-reused',
										children: [
											{ text: '\\u21bb', class: 'vc-field' },
											{ text: '$$name', class: 'vc-pred' },
											{ text: 'wiederverwendet', class: 'vc-field' }
										]
									}
								}
							}
						]
					}
				]
			}
		},
		logic: `function initState(source){source=source||{};var c=source.created;if(c&&!c.length&&c.predicate)c=[c];c=c||[];var created=[];for(var i=0;i<c.length;i++){var d=c[i]||{};var pl=d.places||[];var parts=[];for(var k=0;k<pl.length;k++){parts.push((pl[k].pos||'?')+'='+(pl[k].role||'?')+'('+(pl[k].kind||'')+')');}created.push({predicate:d.predicate||'',gismu:d.gismu?('\\u00b7 '+d.gismu):'',placeCount:pl.length+' Pl\\u00e4tze',gloss:d.gloss||'',placesText:parts.join('  \\u00b7  ')});}var ru=source.reused;if(typeof ru==='string')ru=[ru];ru=ru||[];var reused=[];for(var j=0;j<ru.length;j++){reused.push({name:ru[j]});}return{header:created.length?'Neue Pr\\u00e4dikate':'Wiederverwendet',created:created,reused:reused};}${NOOP}`
	},
	'query-result': {
		view: {
			content: {
				class: 'vc-root',
				children: [
					{
						class: 'vc-header',
						children: [
							{ class: 'vc-dot' },
							{ text: 'Abfrage', class: 'vc-eyebrow' },
							{ text: '$count', class: 'vc-meta' }
						]
					},
					{ text: '$request', class: 'vc-request' },
					{ text: '$emptyMsg', class: 'vc-empty' },
					{
						tag: 'ul',
						class: 'vc-list',
						children: [
							{
								$each: {
									items: '$rows',
									template: {
										tag: 'li',
										class: 'vc-row',
										children: [{ text: '$$line', class: 'vc-line' }]
									}
								}
							}
						]
					}
				]
			}
		},
		logic: `function initState(source){source=source||{};var rows=source.rows||[];var out=[];for(var i=0;i<rows.length;i++){var r=rows[i]||{};var ks=Object.keys(r);var parts=[];for(var k=0;k<ks.length;k++){var v=r[ks[k]];parts.push(ks[k]+': '+(v==null?'\\u2014':String(v)));}out.push({line:parts.join('   \\u00b7   ')});}return{count:out.length+' Treffer',request:source.request?('\\u201e'+source.request+'\\u201c'):'',rows:out,emptyMsg:out.length?'':'Keine Treffer.'};}${NOOP}`
	},
	'mutation-result': {
		view: {
			content: {
				class: 'vc-root',
				children: [
					{
						class: 'vc-header',
						children: [
							{ class: 'vc-dot vc-dot--amber' },
							{ text: 'Mutation', class: 'vc-eyebrow vc-eyebrow--amber' },
							{ text: '$count', class: 'vc-meta' }
						]
					},
					{ text: '$request', class: 'vc-request' },
					{
						tag: 'ul',
						class: 'vc-list',
						children: [
							{
								$each: {
									items: '$ops',
									template: {
										tag: 'li',
										class: 'vc-row',
										children: [
											{ text: '$$label', class: '$$cls' },
											{ text: '$$predicate', class: 'vc-pred' },
											{ text: '$$affected', class: 'vc-field' }
										]
									}
								}
							}
						]
					}
				]
			}
		},
		logic: `function initState(source){source=source||{};var ops=source.ops||[];var out=[];for(var i=0;i<ops.length;i++){var o=ops[i]||{};var del=o.op==='delete';out.push({label:del?'\\u2212 delete':'+ insert',cls:del?'vc-op vc-op--delete':'vc-op vc-op--insert',predicate:o.predicate||'',affected:(typeof o.affected==='number')?('\\u00b7 '+o.affected+' Zeilen'):''});}return{count:out.length+' Schritte',request:source.request?('\\u201e'+source.request+'\\u201c'):'',ops:out};}${NOOP}`
	},
	'todos-created': {
		view: {
			content: {
				class: 'vc-root',
				children: [
					{
						class: 'vc-header',
						children: [
							{ class: 'vc-dot vc-dot--green' },
							{ text: 'Neu erstellt', class: 'vc-eyebrow vc-eyebrow--green' },
							{ text: '$count', class: 'vc-meta' }
						]
					},
					{ text: '$emptyMsg', class: 'vc-empty' },
					{
						tag: 'ul',
						class: 'vc-list',
						children: [
							{
								$each: {
									items: '$items',
									template: {
										tag: 'li',
										class: 'vc-row',
										children: [
											{ text: '$$title', class: 'vc-pred' },
											{ text: '$$chips', class: 'vc-field' }
										]
									}
								}
							}
						]
					}
				]
			}
		},
		logic: `function initState(source){source=source||{};var it=source.items||[];var out=[];for(var i=0;i<it.length;i++){var t=it[i]||{};var chips=[];if(t.due)chips.push(String(t.due));if(t.priority)chips.push(String(t.priority));out.push({title:t.title||'\\u2014',chips:chips.join('  \\u00b7  ')});}return{count:out.length+' Aufgabe(n)',items:out,emptyMsg:out.length?'':'Keine \\u00c4nderungen.'};}${NOOP}`
	},
	'todos-edited': {
		view: {
			content: {
				class: 'vc-root',
				children: [
					{
						class: 'vc-header',
						children: [
							{ class: 'vc-dot' },
							{ text: 'Aktualisiert', class: 'vc-eyebrow' },
							{ text: '$count', class: 'vc-meta' }
						]
					},
					{ text: '$emptyMsg', class: 'vc-empty' },
					{
						tag: 'ul',
						class: 'vc-list',
						children: [
							{
								$each: {
									items: '$diffs',
									template: {
										tag: 'li',
										class: 'vc-card',
										children: [
											{ text: '$$title', class: 'vc-pred' },
											{ text: '$$changesText', class: 'vc-places-text' }
										]
									}
								}
							}
						]
					}
				]
			}
		},
		logic: `function initState(source){source=source||{};var df=source.diffs||[];var out=[];for(var i=0;i<df.length;i++){var d=df[i]||{};var ch=d.changes||[];var parts=[];for(var k=0;k<ch.length;k++){var c=ch[k]||{};parts.push((c.field||'')+': '+(c.from||'\\u2014')+' \\u2192 '+(c.to||'\\u2014'));}out.push({title:d.title||'\\u2014',changesText:parts.join('   \\u00b7   ')});}return{count:out.length+' Aufgabe(n)',diffs:out,emptyMsg:out.length?'':'Keine \\u00c4nderungen.'};}${NOOP}`
	},
	'todos-deleted': {
		view: {
			content: {
				class: 'vc-root',
				children: [
					{
						class: 'vc-header',
						children: [
							{ class: 'vc-dot vc-dot--red' },
							{ text: 'Gelöscht', class: 'vc-eyebrow vc-eyebrow--red' },
							{ text: '$count', class: 'vc-meta' }
						]
					},
					{ text: '$emptyMsg', class: 'vc-empty' },
					{
						tag: 'ul',
						class: 'vc-list',
						children: [
							{
								$each: {
									items: '$items',
									template: {
										tag: 'li',
										class: 'vc-row',
										children: [
											{ text: '\\u2715', class: 'vc-eyebrow--red' },
											{ text: '$$title', class: 'vc-strike' }
										]
									}
								}
							}
						]
					}
				]
			}
		},
		logic: `function initState(source){source=source||{};var it=source.items||[];var out=[];for(var i=0;i<it.length;i++){out.push({title:(it[i]&&it[i].title)||'\\u2014'});}return{count:out.length+' Aufgabe(n)',items:out,emptyMsg:out.length?'':'Keine \\u00c4nderungen.'};}${NOOP}`
	}
}

/** Upsert a vibe row with a BOUND parameter (no string escaping). jsonb tables cast the JSON text. */
async function upsertJson(
	db: Kysely<unknown>,
	table: 'vibe_view' | 'vibe_style',
	name: string,
	value: unknown
): Promise<void> {
	const body = JSON.stringify(value)
	await sql`
		INSERT INTO ${sql.raw(table)} (name, body) VALUES (${name}, ${body}::jsonb)
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
}
async function upsertLogic(db: Kysely<unknown>, name: string, body: string): Promise<void> {
	await sql`
		INSERT INTO vibe_logic (name, body) VALUES (${name}, ${body})
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
	for (const [name, card] of Object.entries(CARDS)) {
		await upsertJson(db, 'vibe_view', name, card.view)
		await upsertJson(db, 'vibe_style', name, STYLE)
		await upsertLogic(db, name, card.logic)
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	for (const name of Object.keys(CARDS)) {
		await sql`DELETE FROM vibe_view WHERE name = ${name}`.execute(db)
		await sql`DELETE FROM vibe_style WHERE name = ${name}`.execute(db)
		await sql`DELETE FROM vibe_logic WHERE name = ${name}`.execute(db)
	}
}
