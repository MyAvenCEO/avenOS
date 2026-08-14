import { describe, expect, test } from 'bun:test'
import { validateStyleDef, validateViewDef } from '@avenos/aven-ui'
import { recipes } from '../src/lib/fibu/recipe-config'
import { runs } from '../src/lib/runs/mock-runs'
import { faceFor, faceKey, faceState } from '../src/lib/runs/step-faces'

/**
 * Die Schritt-Gesichter sind JSON für dieselbe Engine, die die
 * Actor-Faces rendert — also gilt für sie dieselbe Membran: der ViewDef
 * muss durch `validateViewDef`, der StyleDef durch `validateStyleDef`.
 * Ein Gesicht, das die Whitelist verletzt, würde im Shadow-Root werfen
 * statt zu rendern; hier fällt es vorher auf.
 */

describe('step faces: JSON-Views durch die aven-ui-Membran', () => {
	const alleKnoten = recipes.flatMap((r) => r.nodes)

	test('jeder Knoten JEDES Flows bekommt ein gültiges Gesicht', () => {
		for (const node of alleKnoten) {
			const face = faceFor(node)
			expect(face.view).toBeDefined()
			// Wirft bei Conditionals, Ternaries oder verbotenen Pfaden.
			expect(() => validateViewDef(face.view)).not.toThrow()
			expect(() => validateStyleDef(face.style)).not.toThrow()
		}
	})

	test('die Marken-Tokens liegen im Bündel — sonst malt die Engine farblos', () => {
		// Die Engine schreibt NUR `style.tokens` als :host-Variablen. Fehlt
		// withBrand, lösen alle var(--…) ins Leere auf: richtige Geometrie,
		// keine Farbe. Das ist im Screenshot leicht zu übersehen, hier nicht.
		const style = faceFor(alleKnoten[0]).style
		for (const token of ['primary', 'border', 'ok', 'muted', 'bg-a']) {
			expect(style.tokens?.[token]).toBeDefined()
		}
		// Und das Seiten-:host der Marke ist fürs Einbetten zurückgenommen.
		expect(style.selectors?.[':host']?.background).toBe('transparent')
	})

	test('das Gesicht wird am transform.type gewählt, nicht am Flow', () => {
		// Derselbe Typ in verschiedenen Flows ⇒ dasselbe Gesicht.
		const klassifizierer = alleKnoten.filter((n) => n.transform.type.startsWith('llm:classify'))
		expect(klassifizierer.length).toBeGreaterThan(1)
		expect(new Set(klassifizierer.map(faceKey)).size).toBe(1)
		// Und Unbekanntes rät nicht, es fällt zurück.
		const exot = alleKnoten.find((n) => n.transform.type === 'ingest:normalize')
		expect(exot && faceKey(exot)).toBe('rueckfall')
	})

	test('jeder Halt jedes Laufs liefert einen renderbaren Zustand', () => {
		for (const run of runs) {
			const recipe = recipes.find((r) => r.id === run.flow)
			const halte = [...run.weg.map((s) => s.node), run.bei]
			for (const id of halte) {
				const node = recipe?.nodes.find((n) => n.id === id)
				expect(node).toBeDefined()
				if (!node) continue
				const daten = faceState(node, run, { state: 'done', ergebnis: 'idee', um: '09:12' })
				// Kein undefined im Zustand — die Engine bindet sonst ins Leere.
				for (const wert of Object.values(daten)) expect(wert).toBeDefined()
			}
		}
	})

	test('die Klassifikation markiert genau das getroffene Etikett', () => {
		const node = recipes
			.find((r) => r.id === 'intents-triage')
			?.nodes.find((n) => n.id === 'klassifizieren')
		expect(node).toBeDefined()
		if (!node) return
		const run = runs.find((r) => r.id === 'r-002')
		expect(run).toBeDefined()
		if (!run) return
		const klassen = faceState(node, run, {
			state: 'done',
			ergebnis: 'todo',
			guete: { todo: 0.81, idee: 0.13, unbekannt: 0.06 }
		}).klassen as { label: string; cls: string; pct: string; breite: string }[]
		expect(klassen.find((k) => k.label === 'todo')?.cls).toContain('zeile-an')
		// Die Balkenbreite ist die gemessene Güte, nicht Dekoration.
		expect(klassen.find((k) => k.label === 'todo')?.breite).toBe('width: 81%')
		// Sortiert nach Güte — das Urteil steht oben.
		expect(klassen.map((k) => k.label)).toEqual(['todo', 'idee', 'unbekannt'])
		expect(klassen.find((k) => k.label === 'idee')?.cls).not.toContain('zeile-an')
		// Die Vorschau markiert nichts — sie weiß noch nichts.
		const vorschau = faceState(node, run, { state: 'pending' }).klassen as {
			cls: string
			breite: string
		}[]
		expect(vorschau.every((k) => !k.cls.includes('zeile-an'))).toBe(true)
		expect(vorschau.every((k) => k.breite === 'width: 0%')).toBe(true)
	})

	test('die Weiche zeigt alle Zweige und markiert den gegangenen', () => {
		const node = recipes
			.find((r) => r.id === 'intents-triage')
			?.nodes.find((n) => n.id === 'weiche')
		const run = runs.find((r) => r.id === 'r-002')
		if (!node || !run) return
		const zweige = faceState(node, run, { state: 'done', ergebnis: 'Zweig todo' }).zweige as {
			name: string
			marke: string
		}[]
		expect(zweige.map((z) => z.name)).toEqual(['idee', 'todo', 'unbekannt'])
		expect(zweige.filter((z) => z.marke !== '').map((z) => z.name)).toEqual(['todo'])
	})

	test('ein entschiedenes Gate zeigt die Wahl — gewählter Knopf an, Rest verworfen', () => {
		// Der Lauf protokolliert die AKTION, nicht einen Satz über sie: nur
		// so lässt sich die Wahl den Knöpfen des Rezepts zuordnen.
		const node = recipes
			.find((r) => r.id === 'intents-triage')
			?.nodes.find((n) => n.id === 'unklares-einordnen')
		const run = runs.find((r) => r.id === 'r-005')
		const halt = run?.weg.find((s) => s.node === 'unklares-einordnen')
		if (!node || !run || !halt) throw new Error('Beispiel fehlt')
		const daten = faceState(node, run, { state: 'done', um: halt.um, ergebnis: halt.ergebnis })
		const aktionen = daten.aktionen as { label: string; cls: string }[]
		const gewaehlt = aktionen.filter((a) => a.cls.includes('knopf-haupt'))
		expect(gewaehlt.map((a) => a.label)).toEqual(['als-todo'])
		expect(aktionen.filter((a) => a.cls.includes('knopf-weg'))).toHaveLength(2)
		expect(daten.pille).toBe('entschieden')
	})

	test('das Gate zeigt genau die Aktionen aus dem Rezept', () => {
		const node = recipes
			.find((r) => r.id === 'intents-triage')
			?.nodes.find((n) => n.id === 'unklares-einordnen')
		const run = runs.find((r) => r.id === 'r-003')
		if (!node || !run) return
		const aktionen = faceState(node, run, { state: 'current', um: '10:41' }).aktionen as {
			label: string
		}[]
		expect(aktionen.map((a) => a.label)).toEqual(node.transform.config.aktionen)
	})
})
