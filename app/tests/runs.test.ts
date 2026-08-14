import { describe, expect, test } from 'bun:test'
import { recipes } from '../src/lib/fibu/recipe-config'
import { runs } from '../src/lib/runs/mock-runs'

/**
 * Ein Lauf ist nur dann anzeigbar, wenn er auf ein echtes Rezept zeigt:
 * die Ansicht liest Schrittnamen, Knotenart und Gate-Aktionen aus der
 * DEFINITION, nicht aus dem Lauf. Bricht diese Kopplung, rendert der
 * Viewer Löcher — deshalb steht sie hier als Vertrag.
 */

describe('flow runs: die Instanz-Seite hängt am Rezept', () => {
	const byId = new Map(recipes.map((r) => [r.id, r]))

	test('jeder Lauf zeigt auf ein existierendes Rezept', () => {
		for (const run of runs) expect(byId.has(run.flow)).toBe(true)
	})

	test('Position und Weg sind echte Knoten dieses Rezepts', () => {
		for (const run of runs) {
			const nodes = new Set((byId.get(run.flow)?.nodes ?? []).map((n) => n.id))
			expect(nodes.has(run.bei)).toBe(true)
			for (const schritt of run.weg) expect(nodes.has(schritt.node)).toBe(true)
		}
	})

	test('der Weg ist ein gangbarer Pfad: jeder Schritt hat eine Kante zum nächsten', () => {
		for (const run of runs) {
			const recipe = byId.get(run.flow)
			if (!recipe) continue
			const stationen = [...run.weg.map((s) => s.node), run.bei]
			for (let i = 0; i < stationen.length - 1; i++) {
				const kante = recipe.edges.some((e) => e.from === stationen[i] && e.to === stationen[i + 1])
				expect(kante).toBe(true)
			}
		}
	})

	test('ein wartender Lauf steht an einem menschlichen Gate — und nur dort', () => {
		for (const run of runs) {
			const kind = byId.get(run.flow)?.nodes.find((n) => n.id === run.bei)?.kind
			if (run.status === 'wartet') expect(kind).toBe('hitl')
			// Umgekehrt gilt es nicht: ein Gate kann auch schon entschieden sein.
			if (kind === 'output' || kind === 'handoff') expect(run.status).toBe('fertig')
		}
	})

	test('der Viewer ist nicht flow-spezifisch: die Beispiele decken mehrere Flows und alle Endarten', () => {
		expect(new Set(runs.map((r) => r.flow)).size).toBeGreaterThan(1)
		const kinds = new Set(
			runs.map((r) => byId.get(r.flow)?.nodes.find((n) => n.id === r.bei)?.kind)
		)
		// Genau die vier Detail-Zweige der Ansicht kommen in den Daten vor.
		for (const k of ['hitl', 'output', 'handoff', 'transform']) expect(kinds.has(k)).toBe(true)
	})

	test('jedes Gate, an dem ein Lauf wartet, deklariert seine Aktionen im Rezept', () => {
		for (const run of runs.filter((r) => r.status === 'wartet')) {
			const node = byId.get(run.flow)?.nodes.find((n) => n.id === run.bei)
			const aktionen = node?.transform.config.aktionen
			expect(Array.isArray(aktionen)).toBe(true)
			expect((aktionen as string[]).length).toBeGreaterThan(0)
		}
	})
})
