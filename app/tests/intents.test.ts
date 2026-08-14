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

	test('Todo läuft ohne Rückfrage durch — auf eine Liste, nicht an ein Gate', () => {
		const ziel = intentsTriage.edges.find((e) => e.from === 'weiche' && e.fromPort === 'todo')
		expect(ziel?.to).toBe('als-todo-anlegen')
		expect(node('als-todo-anlegen')?.kind).toBe('transform')
		expect(node('als-todo-anlegen')?.transform.type).toBe('list:append')
		// Dieselbe Mechanik wie bei der Idee, nur eine andere Liste: ein Todo
		// ist keine Entscheidung, sondern ein Eintrag.
		expect(node('als-todo-anlegen')?.transform.config.liste).toBe('todo-liste')
		expect(node('out-todos')?.transform.type).toBe('sink:list')
		// Und es gibt kein Gate mehr, das ein Todo aufhielte.
		expect(intentsTriage.nodes.some((n) => n.id === 'todo-bestaetigen')).toBe(false)
		expect(intentsSkill.provides).toContain('todo')
	})

	test('nur das Unklare geht an einen Menschen IM Flow, nicht in den HITL-Skill', () => {
		const ziel = intentsTriage.edges.find((e) => e.from === 'weiche' && e.fromPort === 'unbekannt')
		expect(ziel?.to).toBe('unklares-einordnen')
		expect(node('unklares-einordnen')?.kind).toBe('hitl')
		expect(node('unklares-einordnen')?.transform.type).toBe('hitl:inline')
		// Absente Autonomie heißt: beaufsichtigt. Ein Gate entscheidet nie selbst.
		expect(node('unklares-einordnen')?.autonomie).toBeUndefined()
		// Es ist das EINZIGE Gate des Flows.
		expect(intentsTriage.nodes.filter((n) => n.kind === 'hitl')).toHaveLength(1)
		// Die Vereinfachung ausdrücklich: keine Skill-Grenze, kein handoff.
		expect(intentsTriage.nodes.some((n) => n.kind === 'handoff')).toBe(false)
		expect(intentsSkill.provides).not.toContain('unklar')
	})

	test('jeder Zweig endet in einem Ausgang — kein Zweig verläuft im Sand', () => {
		const ausgaenge = new Set(
			intentsTriage.nodes.filter((n) => n.kind === 'output').map((n) => n.id)
		)
		expect(ausgaenge).toEqual(new Set(['out-board', 'out-todos', 'out-erledigt']))
		for (const port of ['idee', 'todo', 'unbekannt']) {
			// Ein Schritt hinter der Weiche, dann der Ausgang.
			const mitte = intentsTriage.edges.find((e) => e.from === 'weiche' && e.fromPort === port)?.to
			const danach = intentsTriage.edges.find((e) => e.from === mitte)?.to
			expect(ausgaenge.has(String(danach))).toBe(true)
		}
		// Der Entscheidungs-Ausgang bleibt ein Entweder-oder, auch mit nur
		// noch einem Gate davor: der Port ist eine Aussage über den Ausgang,
		// nicht über die Zahl seiner Zuflüsse.
		expect(node('out-erledigt')?.inputs.find((p) => p.name === 'erledigt')?.mode).toBe('any')
	})

	test('flach und blattständig: ein Flow, kein Subflow, keine Verschachtelung', () => {
		expect(intentsTriage.nodes.some((n) => n.kind === 'subflow')).toBe(false)
		// Und niemand faltet ihn in einen anderen Flow hinein.
		for (const r of recipes) {
			for (const n of r.nodes) expect(n.subflow?.recipe).not.toBe('intents-triage')
		}
	})
})
