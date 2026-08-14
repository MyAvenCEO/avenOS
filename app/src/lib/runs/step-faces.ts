import { type StyleDef, type ViewDef, withBrand } from '@avenos/aven-ui'
import type { RecipeNodeConfig } from '../fibu/recipe-config'
import type { FlowRun } from './mock-runs'

/**
 * Die Gesichter der Flow-Schritte — als JSON, gerendert von DERSELBEN
 * aven-ui-Engine, die auch die Actor-Faces malt.
 *
 * Ein Gesicht ist kein beschrifteter Kasten, sondern die Ansicht, die der
 * Schritt hätte, wenn man ihn allein bauen würde: der Klassifikator zeigt
 * sein Urteil MIT den geschlagenen Alternativen und der Schwelle, an der
 * es gemessen wurde; die Weiche zeigt einen Gleisplan, auf dem ein Zweig
 * befahren und die anderen dunkel sind; das menschliche Gate zeigt
 * Knöpfe, die wie Knöpfe aussehen, weil dort tatsächlich jemand drücken
 * soll. Wer den Schritt ansieht, soll ihn verstehen, ohne die
 * Beschreibung darüber zu lesen.
 *
 * Es gilt dieselbe Membran wie im Actor-Teil — keine Conditionals im View
 * (leere Arrays und leere Texte rendern nichts), Listen über `$each`,
 * Klassen und Attribute als Bindung, Brand-Tokens im Style. Die
 * Zustandsformen sind deshalb flach und vorgekaut: Klassen wie
 * `zeile zeile-an` und Breiten wie `width: 81%` entstehen in `faceState`,
 * nicht im View.
 *
 * Gewählt wird das Gesicht über den `transform.type`, nicht über den
 * Flow: `llm:classify` sieht überall gleich aus, ob Notizen oder Belege
 * durchlaufen. Ein unbekannter Typ fällt auf die ehrliche
 * Schlüssel-Wert-Ansicht zurück statt zu raten — genau wie ein Actor ohne
 * View seine generische Ansicht bekommt.
 */

export interface Face {
	view: ViewDef
	style: StyleDef
}

/** Ein Halt des Laufs, so wie die Ansicht ihn kennt. */
export interface Halt {
	state: 'done' | 'current' | 'pending'
	um?: string
	ergebnis?: string
	guete?: Record<string, number>
	port?: string
}

/**
 * Ein Stylesheet für alle Gesichter — über `withBrand`, denn die Engine
 * schreibt NUR `style.tokens` als `:host`-Variablen. Ohne diesen Aufruf
 * lösen `var(--primary)` und Verwandte im Shadow-Root ins Leere auf: die
 * Balken hatten die richtige Breite und keine Farbe.
 *
 * Das `:host` der Marke ist auf eine ganze Seite gemünzt (voller
 * Hintergrund, volle Höhe, eigene Schrift). Ein Gesicht sitzt aber IN
 * einer Karte, also wird genau das zurückgenommen — inklusive der
 * Schriftart, damit es die des Fensters erbt statt als Fremdkörper
 * aufzufallen.
 */
const FACE_STYLE: StyleDef = withBrand({
	selectors: {
		':host': {
			background: 'transparent',
			height: 'auto',
			minHeight: '0',
			fontFamily: 'inherit',
			display: 'block'
		},
		'.face': { display: 'grid', gap: '0.85rem' },
		'.eyebrow': {
			fontSize: '10px',
			fontWeight: '600',
			letterSpacing: '0.09em',
			textTransform: 'uppercase',
			color: 'var(--muted)'
		},
		'.fuss': { fontSize: '11px', color: 'var(--muted)', lineHeight: '1.5' },

		/* Eingang — ein Zettel, so wie er hereinkam. */
		'.zettel': {
			background: 'var(--surface-2)',
			border: '1px solid var(--border)',
			borderLeft: '3px solid var(--brand-accent)',
			borderRadius: 'var(--radius-inner)',
			padding: '1rem 1.1rem'
		},
		'.zettel-text': { fontSize: '15px', lineHeight: '1.6', color: 'var(--text)' },
		'.zettel-fuss': {
			display: 'flex',
			flexWrap: 'wrap',
			gap: '1.75rem',
			marginTop: '0.9rem',
			paddingTop: '0.75rem',
			borderTop: '1px dashed var(--border)'
		},
		'.zelle': { display: 'grid', gap: '0.2rem' },
		'.zelle-wert': { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text)' },

		/* Klassifikation — ein Urteil samt geschlagener Alternativen. */
		'.zitat': {
			fontSize: '13.5px',
			lineHeight: '1.6',
			color: 'var(--muted-strong)',
			paddingLeft: '0.8rem',
			borderLeft: '2px solid var(--border)'
		},
		'.urteil': {
			display: 'grid',
			gap: '0.6rem',
			padding: '0.85rem 0.95rem',
			borderRadius: 'var(--radius-inner)',
			border: '1px solid var(--border)',
			background: 'var(--bg-a)'
		},
		'.urteil-kopf': { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' },
		'.schwelle': { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--muted)' },
		'.balken': { display: 'grid', gap: '0.45rem' },
		'.zeile': {
			display: 'grid',
			gridTemplateColumns: '5.5rem 1fr 2.4rem 0.9rem',
			alignItems: 'center',
			gap: '0.7rem'
		},
		'.zeile-aus': { opacity: '0.5' },
		'.zeile-name': { fontSize: '12px', color: 'var(--muted-strong)' },
		'.zeile-an .zeile-name': { fontWeight: '700', color: 'var(--text)' },
		'.spur': {
			height: '6px',
			borderRadius: '999px',
			background: 'var(--border-soft)',
			overflow: 'hidden'
		},
		// Die geschlagenen Balken bleiben lesbar: das Fazit spricht über den
		// besten Wert, also muss man ihn auch sehen können.
		'.fuell': { height: '100%', borderRadius: '999px', background: 'var(--muted)' },
		'.zeile-an .fuell': { background: 'var(--primary)' },
		'.prozent': {
			fontFamily: 'var(--font-mono)',
			fontSize: '11px',
			textAlign: 'right',
			color: 'var(--muted)'
		},
		'.zeile-an .prozent': { color: 'var(--text)', fontWeight: '600' },
		'.haken': { fontSize: '11px', color: 'var(--ok)', textAlign: 'center' },
		'.fazit': {
			fontSize: '12px',
			lineHeight: '1.5',
			color: 'var(--muted-strong)',
			paddingLeft: '0.7rem',
			borderLeft: '2px solid var(--brand-accent)'
		},

		/* Weiche — ein Gleisplan: ein Zweig befahren, die anderen dunkel. */
		'.gleis-kopf': { display: 'flex', alignItems: 'center', gap: '0.5rem' },
		'.punkt': {
			width: '0.5rem',
			height: '0.5rem',
			borderRadius: '999px',
			background: 'var(--primary)'
		},
		'.gleis-name': { fontSize: '11px', fontWeight: '600', color: 'var(--muted-strong)' },
		'.gleise': {
			display: 'grid',
			gap: '0.4rem',
			marginLeft: '0.25rem',
			paddingLeft: '1.1rem',
			borderLeft: '1px dashed var(--border-strong)'
		},
		'.zweig': {
			position: 'relative',
			display: 'grid',
			gridTemplateColumns: '6rem 1fr auto',
			alignItems: 'baseline',
			gap: '0.75rem',
			padding: '0.5rem 0.7rem',
			borderRadius: 'var(--radius-inner)',
			border: '1px solid transparent'
		},
		'.zweig::before': {
			content: '""',
			position: 'absolute',
			left: '-1.1rem',
			top: '1.1rem',
			width: '0.95rem',
			borderTop: '1px dashed var(--border-strong)'
		},
		'.zweig-an': { background: 'var(--surface-2)', borderColor: 'var(--border)' },
		'.zweig-an::before': { borderTop: '2px solid var(--primary)' },
		'.zweig-aus': { opacity: '0.42' },
		'.zweig-name': { fontSize: '12.5px', fontWeight: '600', color: 'var(--text)' },
		'.zweig-text': { fontSize: '11.5px', lineHeight: '1.5', color: 'var(--muted)' },
		'.marke': {
			fontSize: '9.5px',
			fontWeight: '700',
			letterSpacing: '0.06em',
			textTransform: 'uppercase',
			color: 'var(--primary-foreground)',
			background: 'var(--primary)',
			borderRadius: '999px',
			padding: '0.15rem 0.5rem'
		},

		/* Eintrag — die Karte, die gerade entsteht. */
		'.neu': {
			display: 'grid',
			gap: '0.35rem',
			background: 'var(--surface-2)',
			border: '1px solid var(--border)',
			borderLeft: '3px solid var(--ok)',
			borderRadius: 'var(--radius-inner)',
			padding: '0.9rem 1rem',
			boxShadow: '0 1px 3px rgba(31, 42, 61, 0.06)'
		},
		'.neu-titel': { fontSize: '13.5px', fontWeight: '700', color: 'var(--text)' },
		'.neu-text': { fontSize: '12.5px', lineHeight: '1.55', color: 'var(--muted-strong)' },
		'.neu-fuss': { display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' },
		'.etikett': {
			fontSize: '10px',
			fontWeight: '700',
			letterSpacing: '0.05em',
			textTransform: 'uppercase',
			background: 'var(--secondary)',
			color: 'var(--secondary-foreground)',
			borderRadius: '999px',
			padding: '0.15rem 0.55rem'
		},
		'.neu-meta': { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--muted)' },

		/* Liste — das Zielbrett mit dem neuen Eintrag obenauf. */
		'.brett': {
			border: '1px solid var(--border)',
			borderRadius: 'var(--radius-inner)',
			overflow: 'hidden'
		},
		'.brett-kopf': {
			display: 'flex',
			alignItems: 'baseline',
			justifyContent: 'space-between',
			padding: '0.5rem 0.8rem',
			background: 'var(--bg-a)',
			borderBottom: '1px solid var(--border)'
		},
		'.brett-neu': {
			display: 'grid',
			gap: '0.25rem',
			padding: '0.75rem 0.8rem',
			background: 'var(--surface-2)',
			boxShadow: 'inset 3px 0 0 var(--primary)',
			borderBottom: '1px solid var(--border)'
		},
		'.brett-titel': { fontSize: '12.5px', fontWeight: '700' },
		'.brett-text': { fontSize: '11.5px', lineHeight: '1.5', color: 'var(--muted)' },
		'.geist': {
			display: 'grid',
			gap: '0.4rem',
			padding: '0.75rem 0.8rem',
			borderBottom: '1px solid var(--border-soft)'
		},
		'.geist-a': { height: '0.45rem', borderRadius: '3px', background: 'var(--border)' },
		'.geist-b': { height: '0.45rem', borderRadius: '3px', background: 'var(--border-soft)' },

		/* Protokoll — ein Journal, Zeile für Zeile. */
		'.journal': {
			border: '1px solid var(--border)',
			borderRadius: 'var(--radius-inner)',
			overflow: 'hidden',
			fontFamily: 'var(--font-mono)',
			fontSize: '11px'
		},
		'.j-zeile': {
			display: 'grid',
			gridTemplateColumns: '6.5rem 4rem 1fr',
			gap: '0.75rem',
			padding: '0.5rem 0.8rem',
			borderBottom: '1px solid var(--border-soft)'
		},
		'.j-kopf': {
			background: 'var(--bg-a)',
			fontSize: '9.5px',
			letterSpacing: '0.08em',
			textTransform: 'uppercase',
			color: 'var(--muted)'
		},
		'.j-jetzt': {
			background: 'var(--surface-2)',
			boxShadow: 'inset 2px 0 0 var(--ok)',
			color: 'var(--text)',
			fontWeight: '600'
		},
		'.j-alt': { color: 'var(--muted)', opacity: '0.55' },

		/* Gate — eine echte Entscheidungsfläche. */
		'.warte': { display: 'flex', alignItems: 'center', gap: '0.6rem' },
		'.warte-pille': {
			fontSize: '10px',
			fontWeight: '700',
			letterSpacing: '0.05em',
			textTransform: 'uppercase',
			background: 'var(--secondary)',
			color: 'var(--secondary-foreground)',
			borderRadius: '999px',
			padding: '0.2rem 0.65rem'
		},
		'.warte-pille-fertig': { background: 'var(--ok)', color: '#f6fbf8' },
		'.warte-seit': { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--muted)' },
		'.frage': { fontSize: '13px', fontWeight: '600', color: 'var(--text)' },
		'.stueck': {
			fontSize: '13.5px',
			lineHeight: '1.6',
			background: 'var(--bg-a)',
			borderLeft: '3px solid var(--border-strong)',
			borderRadius: '0.5rem',
			padding: '0.8rem 0.9rem'
		},
		'.knoepfe': { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' },
		'.knopf': {
			font: 'inherit',
			fontSize: '12.5px',
			fontWeight: '600',
			padding: '0.5rem 1.1rem',
			borderRadius: '0.6rem',
			border: '1px solid var(--border-strong)',
			background: 'transparent',
			color: 'var(--muted-strong)',
			cursor: 'default'
		},
		'.knopf-haupt': {
			background: 'var(--primary)',
			borderColor: 'var(--primary)',
			color: 'var(--primary-foreground)'
		},
		'.knopf-weg': { opacity: '0.35', textDecoration: 'line-through' },

		/* Grenze — die Übergabe an einen anderen Skill. */
		'.uebergabe': {
			display: 'grid',
			gridTemplateColumns: 'auto 1fr auto',
			alignItems: 'center',
			gap: '0.75rem'
		},
		'.u-pille': {
			fontFamily: 'var(--font-mono)',
			fontSize: '11px',
			padding: '0.35rem 0.75rem',
			borderRadius: '999px',
			border: '1px solid var(--border)',
			background: 'var(--bg-a)',
			color: 'var(--muted-strong)'
		},
		'.u-pille-ziel': {
			background: 'var(--primary)',
			borderColor: 'var(--primary)',
			color: 'var(--primary-foreground)',
			fontWeight: '600'
		},
		'.u-strecke': { position: 'relative', height: '1.6rem' },
		'.u-strecke::before': {
			content: '""',
			position: 'absolute',
			top: '50%',
			left: '0',
			right: '0.6rem',
			borderTop: '1px dashed var(--border-strong)'
		},
		'.u-strecke::after': {
			content: '"▸"',
			position: 'absolute',
			right: '0',
			top: '50%',
			transform: 'translateY(-50%)',
			fontSize: '11px',
			color: 'var(--border-strong)'
		},
		'.u-fracht': {
			position: 'absolute',
			left: '50%',
			top: '50%',
			transform: 'translate(-50%, -50%)',
			background: 'var(--bg-a)',
			padding: '0 0.5rem',
			fontFamily: 'var(--font-mono)',
			fontSize: '10px',
			color: 'var(--muted)',
			whiteSpace: 'nowrap'
		},

		/* Rückfall — ehrliche Schlüssel-Wert-Ansicht. */
		'.kv': {
			display: 'grid',
			border: '1px solid var(--border)',
			borderRadius: 'var(--radius-inner)',
			overflow: 'hidden'
		},
		'.kv-zeile': {
			display: 'grid',
			gridTemplateColumns: '9rem 1fr',
			gap: '1rem',
			padding: '0.55rem 0.8rem'
		},
		'.kv-zeile:nth-child(odd)': { background: 'var(--bg-a)' },
		'.kv-k': { fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--muted)' },
		'.kv-v': { fontSize: '12px', lineHeight: '1.5', minWidth: '0' }
	}
})

const FACES: Record<string, ViewDef> = {
	eingang: {
		content: {
			class: 'face',
			children: [
				{
					class: 'zettel',
					children: [
						{ class: 'zettel-text', text: '$text' },
						{
							class: 'zettel-fuss',
							$each: {
								items: '$meta',
								template: {
									class: 'zelle',
									children: [
										{ class: 'eyebrow', text: '$$k' },
										{ class: 'zelle-wert', text: '$$v' }
									]
								}
							}
						}
					]
				}
			]
		}
	},
	klassifikation: {
		content: {
			class: 'face',
			children: [
				{ class: 'zitat', text: '$text' },
				{
					class: 'urteil',
					children: [
						{
							class: 'urteil-kopf',
							children: [
								{ class: 'eyebrow', text: '$titel' },
								{ class: 'schwelle', text: '$schwelle' }
							]
						},
						{
							class: 'balken',
							$each: {
								items: '$klassen',
								template: {
									class: '$$cls',
									children: [
										{ class: 'zeile-name', text: '$$label' },
										{ class: 'spur', children: [{ class: 'fuell', attrs: { style: '$$breite' } }] },
										{ class: 'prozent', text: '$$pct' },
										{ class: 'haken', text: '$$haken' }
									]
								}
							}
						}
					]
				},
				{ class: 'fazit', text: '$fazit' }
			]
		}
	},
	weiche: {
		content: {
			class: 'face',
			children: [
				{
					class: 'gleis-kopf',
					children: [{ class: 'punkt' }, { class: 'gleis-name', text: '$eingang' }]
				},
				{
					class: 'gleise',
					$each: {
						items: '$zweige',
						template: {
							class: '$$cls',
							children: [
								{ class: 'zweig-name', text: '$$name' },
								{ class: 'zweig-text', text: '$$beschreibung' },
								{ class: '$$markeCls', text: '$$marke' }
							]
						}
					}
				},
				{ class: 'fuss', text: '$hinweis' }
			]
		}
	},
	eintrag: {
		content: {
			class: 'face',
			children: [
				{ class: 'eyebrow', text: '$titel' },
				{
					class: 'neu',
					children: [
						{ class: 'neu-titel', text: '$kartentitel' },
						{ class: 'neu-text', text: '$text' },
						{
							class: 'neu-fuss',
							children: [
								{ class: 'etikett', text: '$etikett' },
								{ class: 'neu-meta', text: '$meta' }
							]
						}
					]
				},
				{ class: 'fuss', text: '$hinweis' }
			]
		}
	},
	liste: {
		content: {
			class: 'face',
			children: [
				{
					class: 'brett',
					children: [
						{
							class: 'brett-kopf',
							children: [
								{ class: 'eyebrow', text: '$brett' },
								{ class: 'schwelle', text: '$ansicht' }
							]
						},
						{
							class: 'brett-neu',
							children: [
								{ class: 'brett-titel', text: '$titel' },
								{ class: 'brett-text', text: '$text' }
							]
						},
						{
							$each: {
								items: '$rest',
								template: {
									class: 'geist',
									children: [
										{ class: 'geist-a', attrs: { style: '$$a' } },
										{ class: 'geist-b', attrs: { style: '$$b' } }
									]
								}
							}
						}
					]
				},
				{ class: 'fuss', text: '$hinweis' }
			]
		}
	},
	protokoll: {
		content: {
			class: 'face',
			children: [
				{
					class: 'journal',
					children: [
						{
							class: 'j-zeile j-kopf',
							children: [{ text: 'Datum' }, { text: 'Lauf' }, { text: 'Eintrag' }]
						},
						{
							class: 'j-zeile j-jetzt',
							children: [{ text: '$datum' }, { text: '$id' }, { text: '$aktion' }]
						},
						{
							$each: {
								items: '$frueher',
								template: {
									class: 'j-zeile j-alt',
									children: [{ text: '$$d' }, { text: '$$i' }, { text: '$$a' }]
								}
							}
						}
					]
				},
				{ class: 'fuss', text: '$hinweis' }
			]
		}
	},
	gate: {
		content: {
			class: 'face',
			children: [
				{
					class: 'warte',
					children: [
						{ class: '$pilleCls', text: '$pille' },
						{ class: 'warte-seit', text: '$seit' }
					]
				},
				{ class: 'frage', text: '$frage' },
				{ class: 'stueck', text: '$text' },
				{
					class: 'knoepfe',
					$each: {
						items: '$aktionen',
						template: { tag: 'button', class: '$$cls', text: '$$label' }
					}
				},
				{ class: 'fuss', text: '$hinweis' }
			]
		}
	},
	grenze: {
		content: {
			class: 'face',
			children: [
				{
					class: 'uebergabe',
					children: [
						{ class: 'u-pille', text: '$von' },
						{ class: 'u-strecke', children: [{ class: 'u-fracht', text: '$fracht' }] },
						{ class: 'u-pille u-pille-ziel', text: '$nach' }
					]
				},
				{ class: 'fuss', text: '$hinweis' }
			]
		}
	},
	rueckfall: {
		content: {
			class: 'face',
			children: [
				{
					class: 'kv',
					$each: {
						items: '$felder',
						template: {
							class: 'kv-zeile',
							children: [
								{ class: 'kv-k', text: '$$name' },
								{ class: 'kv-v', text: '$$wert' }
							]
						}
					}
				},
				{ class: 'fuss', text: '$hinweis' }
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

const datum = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })
const prozent = (v: number) => `${Math.round(v * 100)} %`

/**
 * Der Zustand für das Gesicht: aus der Config (was der Schritt DARF), dem
 * Halt (was er TAT, wann, wie sicher) und dem Gegenstand (womit).
 *
 * Ein noch nicht erreichter Schritt bekommt dieselbe Form mit leeren
 * Markierungen und Balken auf null — das ist die Vorschau, kein zweiter
 * Codepfad.
 */
export function faceState(
	node: RecipeNodeConfig,
	run: FlowRun,
	halt: Halt,
	/**
	 * Wohin die Ausgänge dieses Schritts führen (Port → Name des Ziels).
	 * Ein Rezept muss seine Zweige nicht beschreiben; dann ist das Ziel die
	 * ehrlichste Beschriftung, die es gibt — besser als eine leere Zeile.
	 */
	ziele: Record<string, string> = {}
): Record<string, unknown> {
	const config = node.transform.config as Record<string, unknown>
	const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])
	const offen = halt.state === 'pending'
	const traf = (k: string) =>
		!offen && (halt.ergebnis ?? '').toLowerCase().includes(k.toLowerCase())
	const text = haupttext(run)
	const wann = `${datum.format(new Date(run.erfasst))}${halt.um ? ` · ${halt.um}` : ''}`

	switch (faceKey(node)) {
		case 'eingang':
			// Nur wann es hereinkam. Quelle, Format und Feldliste sind
			// Innereien des Rezepts — die gehören in einen Technik-Reiter,
			// nicht vor einen Menschen, der wissen will, was ankam.
			return { text, meta: [{ k: 'Erfasst', v: wann }] }

		case 'klassifikation': {
			// Gemessen wird gegen die Klassen des Rezepts, sortiert nach Güte:
			// ein Urteil ist erst dann eins, wenn man die Alternativen sieht.
			const guete = halt.guete ?? {}
			const klassen = arr(config.klassen)
			const kandidaten = klassen.length ? klassen : Object.keys(guete)
			const schwelle = typeof config.schwelle === 'number' ? config.schwelle : null
			const beste = Object.entries(guete).sort((a, b) => b[1] - a[1])[0]
			const reihen = kandidaten
				.map((label) => ({ label, wert: guete[label] ?? 0 }))
				.sort((a, b) => b.wert - a.wert)
				.map(({ label, wert }) => ({
					label,
					cls: traf(label) ? 'zeile zeile-an' : 'zeile zeile-aus',
					breite: `width: ${offen ? 0 : Math.round(wert * 100)}%`,
					pct: offen ? '—' : prozent(wert),
					haken: traf(label) ? '✓' : ''
				}))
			const unterSchwelle = schwelle !== null && beste != null && beste[1] < schwelle
			const rueckfall = String(config.fallback ?? config.unterSchwelle ?? 'unbekannt')
			return {
				text,
				titel: 'Urteil',
				schwelle: schwelle === null ? 'ohne Schwelle' : `Schwelle ${prozent(schwelle)}`,
				klassen: reihen,
				fazit: offen
					? 'Noch nicht eingeordnet — der Gegenstand wartet auf das Modell.'
					: unterSchwelle
						? `Bester Wert ${prozent(beste[1])} liegt unter der Schwelle — Rückfall auf „${rueckfall}“ statt Rateversuch.`
						: `Eingeordnet als „${halt.ergebnis ?? '—'}“.`
			}
		}

		case 'weiche': {
			const zweige = (config.zweige ?? {}) as Record<string, string>
			// Knotennamen dürfen selbst schon einen Pfeil tragen ("→ HITL") —
			// dann setzt das Gesicht keinen zweiten davor.
			const zielName = (port: string) => (ziele[port] ?? '').replace(/^[→▸\s]+/, '')
			return {
				eingang: node.inputs.map((p) => p.name).join(' · ') || 'Eingang',
				zweige: node.outputs.map((p) => {
					const an = traf(p.name)
					return {
						name: p.name,
						beschreibung: zweige[p.name] ?? (zielName(p.name) ? `→ ${zielName(p.name)}` : ''),
						cls: an ? 'zweig zweig-an' : 'zweig zweig-aus',
						marke: an ? 'befahren' : '',
						markeCls: an ? 'marke' : ''
					}
				}),
				hinweis: offen
					? 'Genau ein Zweig wird feuern — welcher, entscheidet das Etikett aus dem Schritt davor.'
					: ''
			}
		}

		case 'eintrag':
			return {
				titel: offen ? 'Wird angelegt' : 'Angelegt',
				kartentitel: run.gegenstand.titel ?? run.titel,
				text,
				etikett: String(config.liste ?? node.outputs[0]?.name ?? 'eintrag').replace(/-/g, ' '),
				meta: `${wann}${halt.ergebnis ? ` · ${halt.ergebnis}` : ''}`,
				hinweis: `Felder aus dem Rezept: ${arr(config.felder).join(', ') || '—'}`
			}

		case 'liste':
			return {
				brett: String(config.liste ?? node.name),
				ansicht: String(config.ansicht ?? 'liste'),
				titel: run.gegenstand.titel ?? run.titel,
				text,
				// Der Rest des Bretts ist Attrappe — verschieden lange Balken,
				// damit es wie Inhalt aussieht und nicht wie ein Fehler.
				rest: [
					{ a: 'width: 38%', b: 'width: 72%' },
					{ a: 'width: 52%', b: 'width: 61%' },
					{ a: 'width: 30%', b: 'width: 80%' }
				],
				hinweis: 'Attrappe: nur der oberste Eintrag ist dieser Lauf, der Rest ist Platzhalter.'
			}

		case 'protokoll':
			return {
				datum: run.erfasst.slice(0, 10),
				id: run.id,
				aktion: offen ? '<wird eingetragen>' : (halt.ergebnis ?? run.titel),
				frueher: [{ d: '…', i: '…', a: 'frühere Einträge' }],
				hinweis: `Ziel: ${String(config.log ?? config.ziel ?? node.name)}`
			}

		case 'gate': {
			const aktionen = arr(config.aktionen)
			const entschieden = halt.state === 'done'
			const gewaehlt = aktionen.find((a) => traf(a))
			return {
				pille: entschieden ? 'entschieden' : offen ? 'kommt noch' : 'wartet auf dich',
				pilleCls: entschieden ? 'warte-pille warte-pille-fertig' : 'warte-pille',
				seit: entschieden ? `${halt.um ?? ''} · ${halt.ergebnis ?? ''}` : `seit ${halt.um ?? wann}`,
				frage: String(config.frage ?? 'Was soll damit passieren?'),
				text,
				// Nach der Entscheidung bleibt der gewählte Knopf stehen und die
				// verworfenen sind durchgestrichen: die Wahl bleibt sichtbar.
				aktionen: aktionen.map((label, i) => ({
					label,
					cls: gewaehlt
						? label === gewaehlt
							? 'knopf knopf-haupt'
							: 'knopf knopf-weg'
						: i === 0
							? 'knopf knopf-haupt'
							: 'knopf'
				})),
				hinweis: entschieden
					? ''
					: 'Attrappe: die Aktionen stehen so im Rezept, geklickt wird hier nichts.'
			}
		}

		case 'grenze':
			return {
				von: run.flow,
				nach: node.handoff?.skill ?? '',
				fracht: node.inputs.map((p) => p.name).join(' · '),
				hinweis: 'Der Lauf endet hier und wird im anderen Skill zu einem neuen.'
			}

		default:
			return {
				felder: Object.entries(config).map(([name, wert]) => ({
					name,
					wert: typeof wert === 'string' ? wert : JSON.stringify(wert)
				})),
				hinweis: `Kein eigenes Gesicht für „${node.transform.type}“ — gezeigt wird, was im Rezept steht.`
			}
	}
}
