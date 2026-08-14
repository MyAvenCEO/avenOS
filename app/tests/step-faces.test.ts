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
				const daten = faceState(node, run, 'done', 'idee')
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
		const klassen = faceState(node, run, 'done', 'todo').klassen as { label: string; cls: string }[]
		expect(klassen.find((k) => k.label === 'todo')?.cls).toContain('chip-on')
		expect(klassen.find((k) => k.label === 'idee')?.cls).not.toContain('chip-on')
		// Die Vorschau markiert nichts — sie weiß noch nichts.
		const vorschau = faceState(node, run, 'pending').klassen as { cls: string }[]
		expect(vorschau.every((k) => !k.cls.includes('chip-on'))).toBe(true)
	})

	test('die Weiche zeigt alle Zweige und markiert den gegangenen', () => {
		const node = recipes
			.find((r) => r.id === 'intents-triage')
			?.nodes.find((n) => n.id === 'weiche')
		const run = runs.find((r) => r.id === 'r-002')
		if (!node || !run) return
		const zweige = faceState(node, run, 'done', 'Zweig todo').zweige as {
			name: string
			mark: string
		}[]
		expect(zweige.map((z) => z.name)).toEqual(['idee', 'todo', 'unbekannt'])
		expect(zweige.filter((z) => z.mark === '→').map((z) => z.name)).toEqual(['todo'])
	})

	test('das Gate zeigt genau die Aktionen aus dem Rezept', () => {
		const node = recipes
			.find((r) => r.id === 'intents-triage')
			?.nodes.find((n) => n.id === 'todo-bestaetigen')
		const run = runs.find((r) => r.id === 'r-002')
		if (!node || !run) return
		const aktionen = faceState(node, run, 'current').aktionen as { label: string }[]
		expect(aktionen.map((a) => a.label)).toEqual(node.transform.config.aktionen)
	})
})
