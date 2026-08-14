import type { StyleDef, ViewDef } from '@avenos/aven-ui'
import type { RecipeNodeConfig } from '../fibu/recipe-config'
import type { FlowRun } from './mock-runs'

/**
 * Die Gesichter der Flow-Schritte — als JSON, gerendert von DERSELBEN
 * aven-ui-Engine, die auch die Actor-Faces malt.
 *
 * Kein handgeschriebenes Svelte pro Schritt: ein Gesicht ist ein ViewDef
 * plus ein StyleDef, der Zustand ist ein flaches Objekt, und die Engine
 * setzt beides in einen Shadow-Root. Damit gilt hier dieselbe Membran wie
 * im Actor-Teil — keine Conditionals im View (leere Arrays rendern
 * nichts), Listen über `$each` auf dem Container, Klassen als Bindung,
 * Brand-Tokens im Style.
 *
 * Gewählt wird das Gesicht über den `transform.type`, nicht über den
 * Flow: `llm:classify` sieht überall gleich aus, ob Notizen oder Belege
 * durchlaufen; `sink:list` ist immer eine Liste. Ein unbekannter Typ
 * fällt auf die ehrliche Schlüssel-Wert-Ansicht zurück statt zu raten —
 * genau wie ein Actor ohne View seine generische Ansicht bekommt.
 */

export interface Face {
	view: ViewDef
	style: StyleDef
}

/** Ein Stylesheet für alle Gesichter — die Engine lädt es je Schritt neu. */
const FACE_STYLE: StyleDef = {
	selectors: {
		'.face': { display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%' },
		'.quote': {
			fontSize: 'var(--fs-body)',
			fontStyle: 'italic',
			color: 'var(--muted-strong)',
			lineHeight: '1.5'
		},
		'.card': {
			display: 'flex',
			flexDirection: 'column',
			gap: '0.3rem',
			padding: '0.75rem',
			borderRadius: 'var(--radius-inner)',
			border: '1px solid var(--border)',
			background: 'var(--bg-a)'
		},
		'.card-dashed': { borderStyle: 'dashed' },
		'.card-warm': { background: 'var(--surface)', borderColor: 'var(--primary)' },
		'.row': { display: 'flex', alignItems: 'baseline', gap: '0.75rem' },
		'.key': {
			width: '5.5rem',
			flexShrink: '0',
			fontFamily: 'var(--font-mono)',
			fontSize: 'var(--fs-micro)',
			color: 'var(--muted)'
		},
		'.val': { flex: '1', minWidth: '0', fontSize: 'var(--fs-small)', lineHeight: '1.5' },
		'.chips': { display: 'flex', flexWrap: 'wrap', gap: '0.4rem' },
		'.chip': {
			padding: '0.25rem 0.7rem',
			borderRadius: 'var(--radius-pill)',
			border: '1px solid var(--border)',
			fontSize: 'var(--fs-micro)',
			color: 'var(--muted)'
		},
		'.chip-on': {
			background: 'var(--primary)',
			borderColor: 'var(--primary)',
			color: 'var(--primary-foreground)',
			fontWeight: '600'
		},
		'.branch': {
			display: 'flex',
			alignItems: 'baseline',
			gap: '0.6rem',
			padding: '0.4rem 0.6rem',
			borderRadius: 'var(--radius-inner)'
		},
		'.branch-on': { background: 'var(--surface)' },
		'.branch-off': { opacity: '0.45' },
		'.mark': {
			width: '1rem',
			flexShrink: '0',
			fontFamily: 'var(--font-mono)',
			color: 'var(--primary)'
		},
		'.name': { width: '6rem', flexShrink: '0', fontSize: 'var(--fs-small)', fontWeight: '600' },
		'.hint': { fontSize: 'var(--fs-micro)', color: 'var(--muted)' },
		'.list': {
			display: 'flex',
			flexDirection: 'column',
			borderRadius: 'var(--radius-inner)',
			border: '1px solid var(--border)',
			overflow: 'hidden'
		},
		'.list-first': {
			display: 'flex',
			flexDirection: 'column',
			gap: '0.15rem',
			padding: '0.6rem 0.75rem',
			background: 'var(--surface)',
			borderBottom: '1px solid var(--border)'
		},
		'.list-title': { fontSize: 'var(--fs-small)', fontWeight: '600' },
		'.list-sub': { fontSize: 'var(--fs-micro)', color: 'var(--muted)' },
		'.skeleton': {
			display: 'flex',
			flexDirection: 'column',
			gap: '0.4rem',
			padding: '0.75rem',
			borderBottom: '1px solid var(--border)'
		},
		'.bar-a': { height: '0.5rem', width: '35%', borderRadius: '3px', background: 'var(--border)' },
		'.bar-b': { height: '0.5rem', width: '65%', borderRadius: '3px', background: 'var(--bg-a)' },
		'.log': {
			display: 'flex',
			flexDirection: 'column',
			gap: '0.2rem',
			padding: '0.7rem',
			borderRadius: 'var(--radius-inner)',
			background: 'var(--bg-a)',
			fontFamily: 'var(--font-mono)',
			fontSize: 'var(--fs-micro)'
		},
		'.log-dim': { color: 'var(--muted)' },
		'.hand': {
			display: 'flex',
			alignItems: 'center',
			gap: '0.6rem',
			padding: '0.75rem',
			borderRadius: 'var(--radius-inner)',
			border: '1px dashed var(--border)'
		},
		'.mono': { fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-micro)', color: 'var(--muted)' },
		'.pill': {
			padding: '0.25rem 0.7rem',
			borderRadius: 'var(--radius-pill)',
			background: 'var(--surface)',
			fontSize: 'var(--fs-micro)',
			fontWeight: '600'
		}
	}
}

/** Schlüssel-Wert-Karte — der Rückfall und der Eingang. */
const rowsFace = (dashed: boolean): ViewDef => ({
	content: {
		class: 'face',
		children: [
			{
				class: dashed ? 'card card-dashed' : 'card',
				$each: {
					items: '$felder',
					template: {
						class: 'row',
						children: [
							{ class: 'key', text: '$$name' },
							{ class: 'val', text: '$$wert' }
						]
					}
				}
			},
			{ class: 'hint', $each: { items: '$hinweise', template: { text: '$$text' } } }
		]
	}
})

const FACES: Record<string, ViewDef> = {
	eingang: rowsFace(true),
	rueckfall: rowsFace(false),
	klassifikation: {
		content: {
			class: 'face',
			children: [
				{ class: 'quote', text: '$text' },
				{
					class: 'chips',
					$each: { items: '$klassen', template: { class: '$$cls', text: '$$label' } }
				},
				{ class: 'hint', $each: { items: '$hinweise', template: { text: '$$text' } } }
			]
		}
	},
	weiche: {
		content: {
			class: 'face',
			$each: {
				items: '$zweige',
				template: {
					class: '$$cls',
					children: [
						{ class: 'mark', text: '$$mark' },
						{ class: 'name', text: '$$name' },
						{ class: 'val', text: '$$beschreibung' }
					]
				}
			}
		}
	},
	eintrag: {
		content: {
			class: 'face',
			children: [
				{
					class: 'card card-warm',
					$each: {
						items: '$felder',
						template: {
							class: 'row',
							children: [
								{ class: 'key', text: '$$name' },
								{ class: 'val', text: '$$wert' }
							]
						}
					}
				},
				{ class: 'hint', $each: { items: '$hinweise', template: { text: '$$text' } } }
			]
		}
	},
	liste: {
		content: {
			class: 'face',
			children: [
				{
					class: 'list',
					children: [
						{
							class: 'list-first',
							children: [
								{ class: 'list-title', text: '$titel' },
								{ class: 'list-sub', text: '$text' }
							]
						},
						{
							$each: {
								items: '$platzhalter',
								template: {
									class: 'skeleton',
									children: [{ class: 'bar-a' }, { class: 'bar-b' }]
								}
							}
						}
					]
				},
				{ class: 'hint', $each: { items: '$hinweise', template: { text: '$$text' } } }
			]
		}
	},
	protokoll: {
		content: {
			class: 'face',
			children: [
				{
					class: 'log',
					children: [{ text: '$zeile' }, { class: 'log-dim', text: '…' }]
				}
			]
		}
	},
	gate: {
		content: {
			class: 'face',
			children: [
				{
					class: 'card card-warm',
					children: [
						{ class: 'val', text: '$text' },
						{
							class: 'chips',
							$each: { items: '$aktionen', template: { class: '$$cls', text: '$$label' } }
						}
					]
				},
				{ class: 'hint', $each: { items: '$hinweise', template: { text: '$$text' } } }
			]
		}
	},
	grenze: {
		content: {
			class: 'face',
			children: [
				{
					class: 'hand',
					children: [
						{ class: 'mono', text: '$von' },
						{ class: 'mono', text: '→' },
						{ class: 'pill', text: '$nach' },
						{ class: 'mono', text: '$ports' }
					]
				}
			]
		}
	}
}

/** Welches Gesicht ein Schritt trägt — entschieden am transform.type. */
export function faceKey(node: RecipeNodeConfig): keyof typeof FACES {
	const t = node.transform.type
	if (node.kind === 'handoff') return 'grenze'
	if (t.startsWith('source:')) return 'eingang'
	if (t.startsWith('llm:classify')) return 'klassifikation'
	if (t.startsWith('route:')) return 'weiche'
	if (t === 'list:append') return 'eintrag'
	if (t === 'sink:list') return 'liste'
	if (t === 'sink:log') return 'protokoll'
	if (t === 'hitl:inline') return 'gate'
	return 'rueckfall'
}

export function faceFor(node: RecipeNodeConfig): Face {
	return { view: FACES[faceKey(node)], style: FACE_STYLE }
}

/** Der längste Text des Gegenstands — das, was inhaltlich durchläuft. */
function haupttext(run: FlowRun): string {
	return Object.values(run.gegenstand).sort((a, b) => b.length - a.length)[0] ?? ''
}

/**
 * Der Zustand für das Gesicht: aus der Config (was der Schritt DARF), dem
 * Ergebnis (was er TAT) und dem Gegenstand (womit). Ein noch nicht
 * erreichter Schritt bekommt dieselbe Form mit leeren Markierungen — das
 * ist die Vorschau.
 */
export function faceState(
	node: RecipeNodeConfig,
	run: FlowRun,
	state: 'done' | 'current' | 'pending',
	ergebnis?: string
): Record<string, unknown> {
	const config = node.transform.config as Record<string, unknown>
	const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])
	const traf = (k: string) =>
		state !== 'pending' && (ergebnis ?? '').toLowerCase().includes(k.toLowerCase())
	const text = haupttext(run)
	const hinweise = (t?: string) => (t ? [{ text: t }] : [])

	switch (faceKey(node)) {
		case 'eingang':
			return {
				felder: Object.entries(run.gegenstand).map(([name, wert]) => ({ name, wert })),
				hinweise: []
			}
		case 'klassifikation':
			return {
				text,
				klassen: arr(config.klassen).map((label) => ({
					label,
					cls: traf(label) ? 'chip chip-on' : 'chip'
				})),
				hinweise: hinweise(state === 'pending' ? 'Noch nicht eingeordnet.' : `Urteil: ${ergebnis}`)
			}
		case 'weiche': {
			const zweige = (config.zweige ?? {}) as Record<string, string>
			return {
				zweige: node.outputs.map((p) => ({
					name: p.name,
					beschreibung: zweige[p.name] ?? '',
					mark: traf(p.name) ? '→' : '',
					cls: traf(p.name) ? 'branch branch-on' : 'branch branch-off'
				}))
			}
		}
		case 'eintrag':
			return {
				felder: arr(config.felder).map((name) => ({
					name,
					wert: run.gegenstand[name] ?? (state === 'pending' ? '—' : text)
				})),
				hinweise: hinweise(state === 'pending' ? undefined : ergebnis)
			}
		case 'liste':
			return {
				titel: run.titel,
				text,
				platzhalter: [{}, {}],
				hinweise: hinweise(
					`${String(config.liste ?? '')} · ${String(config.ansicht ?? '')} — die übrigen Einträge sind Platzhalter.`
				)
			}
		case 'protokoll':
			return {
				zeile: `${run.erfasst.slice(0, 10)} · ${run.id} · ${state === 'pending' ? '<Aktion>' : (ergebnis ?? run.titel)}`
			}
		case 'gate':
			return {
				text,
				aktionen: arr(config.aktionen).map((label, i) => ({
					label,
					cls: i === 0 ? 'chip chip-on' : 'chip'
				})),
				hinweise: hinweise('Attrappe: die Aktionen stehen so im Rezept, geklickt wird hier nichts.')
			}
		case 'grenze':
			return {
				von: run.flow,
				nach: node.handoff?.skill ?? '',
				ports: node.inputs.map((p) => p.name).join(' · ')
			}
		default:
			return {
				felder: Object.entries(config).map(([name, wert]) => ({
					name,
					wert: typeof wert === 'string' ? wert : JSON.stringify(wert)
				})),
				hinweise: []
			}
	}
}
