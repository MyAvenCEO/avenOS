import { describe, expect, test } from 'bun:test'
import { intentsSkill, intentsTriage } from '../src/lib/fibu/intents-config'
import { recipes } from '../src/lib/fibu/recipe-config'
import { skills } from '../src/lib/fibu/skill-config'

/**
 * Intents ist der Test-Skill für das Rezept-Modell: Notiz rein, ein
 * Etikett drauf, drei Wege raus. Die generischen Invarianten (Ports, DAG,
 * Erreichbarkeit, Entweder-oder-Joins, Autonomie-Nachweise) prüfen die
 * fibu-Suiten über die ganze Registry — hier steht, dass dieser eine Skill
 * auch wirklich das tut, wofür er gebaut wurde.
 */

describe('intents: die kleinste Triage', () => {
	const node = (id: string) => intentsTriage.nodes.find((n) => n.id === id)

	test('der Skill ist registriert und bringt genau seinen einen Flow mit', () => {
		expect(skills.find((s) => s.id === 'intents')).toBe(intentsSkill)
		expect(recipes.find((r) => r.id === 'intents-triage')).toBe(intentsTriage)
		expect(intentsSkill.flows).toEqual(['intents-triage'])
		expect(intentsSkill.entry).toBe('intents-triage')
		expect(intentsSkill.accepts).toEqual(['notiz'])
	})

	test('der Eingang sind Notizen — freier Text, sonst nichts', () => {
		const inputs = intentsTriage.nodes.filter((n) => n.kind === 'input')
		expect(inputs.length).toBe(1)
		expect(inputs[0].transform.type).toBe('source:notes')
		expect(inputs[0].transform.config.format).toBe('freitext')
	})

	test('klassifiziert wird in genau drei Klassen, Unbekanntes ist der Auffang', () => {
		const klass = node('klassifizieren')
		expect(klass?.kind).toBe('transform')
		expect(klass?.transform.config.klassen).toEqual(['idee', 'todo', 'unbekannt'])
		expect(klass?.transform.config.fallback).toBe('unbekannt')
		// Es ist ein Modell-Aufruf — also mit erklärtem Zweck und harten Grenzen.
		expect(klass?.llm?.purpose).toBeTruthy()
		expect(klass?.llm?.constraints.length).toBeGreaterThan(0)
		// Und die Weiche kennt exakt dieselben drei Zweige, keinen vierten.
		const weiche = node('weiche')
		expect(weiche?.kind).toBe('route')
		expect(weiche?.outputs.map((p) => p.name)).toEqual(['idee', 'todo', 'unbekannt'])
	})

	test('Idee führt auf ein BOARD — eine Liste, keine zweite Notizsammlung', () => {
		const board = node('out-board')
		expect(board?.kind).toBe('output')
		expect(board?.transform.type).toBe('sink:list')
		expect(board?.transform.config.ansicht).toBe('liste')
		// Der Übergang Notiz → Listeneintrag passiert sichtbar in einem Schritt.
		const anlegen = node('als-idee-anlegen')
		expect(anlegen?.transform.type).toBe('list:append')
		expect(intentsTriage.edges).toContainEqual({
			id: 'it3',
			from: 'weiche',
			fromPort: 'idee',
			to: 'als-idee-anlegen',
			toPort: 'idee'
		})
	})

	test('Todo und Unbekanntes landen bei einem Menschen IM Flow, nicht im HITL-Skill', () => {
		for (const [branch, gate] of [
			['todo', 'todo-bestaetigen'],
			['unbekannt', 'unklares-einordnen']
		]) {
			const target = intentsTriage.edges.find((e) => e.from === 'weiche' && e.fromPort === branch)
			expect(target?.to).toBe(gate)
			expect(node(gate)?.kind).toBe('hitl')
			expect(node(gate)?.transform.type).toBe('hitl:inline')
			// Absente Autonomie heißt: beaufsichtigt. Ein Gate entscheidet nie selbst.
			expect(node(gate)?.autonomie).toBeUndefined()
		}
		// Das Todo zählt erst, wenn ein Mensch es übernimmt.
		expect(node('todo-bestaetigen')?.transform.config.aktionen).toContain('übernehmen')
		// Die Vereinfachung ausdrücklich: keine Skill-Grenze, kein handoff.
		expect(intentsTriage.nodes.some((n) => n.kind === 'handoff')).toBe(false)
		expect(intentsSkill.provides).not.toContain('unklar')
	})

	test('beide Gates münden in EINEN Ausgang, und der Port ist ein Entweder-oder', () => {
		const out = node('out-erledigt')
		const feeding = intentsTriage.edges.filter((e) => e.to === 'out-erledigt')
		expect(feeding.length).toBe(2)
		expect(out?.inputs.find((p) => p.name === 'erledigt')?.mode).toBe('any')
	})

	test('flach und blattständig: ein Flow, kein Subflow, keine Verschachtelung', () => {
		expect(intentsTriage.nodes.some((n) => n.kind === 'subflow')).toBe(false)
		// Und niemand faltet ihn in einen anderen Flow hinein.
		for (const r of recipes) {
			for (const n of r.nodes) expect(n.subflow?.recipe).not.toBe('intents-triage')
		}
	})
})
