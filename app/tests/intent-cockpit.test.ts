import { describe, expect, test } from 'bun:test'
import { eingaenge, FACE_KEYS, intentStatus, intents } from '../src/lib/intents/mock-intents'

/**
 * Der Vertrag des Intent-Cockpits — die Regeln, die den Mock ehrlich
 * halten, damit das UX-Brainstorming auf konsistenten Beispielen steht:
 * Abhängigkeiten sind echt, Status sind abgeleitet, Parallelität kommt
 * vor, und jedes Gesicht existiert.
 */

describe('intent cockpit: der Vertrag der Beispiele', () => {
	test('jede Abhängigkeit zeigt auf einen Lauf DESSELBEN Intents', () => {
		for (const i of intents) {
			const ids = new Set(i.runs.map((r) => r.id))
			for (const r of i.runs) {
				if (r.braucht) expect(ids.has(r.braucht.run)).toBe(true)
			}
		}
	})

	test('wartet-ergebnis heißt: das Gebrauchte liegt wirklich noch nicht vor', () => {
		for (const i of intents) {
			for (const r of i.runs) {
				const lieferant = i.runs.find((x) => x.id === r.braucht?.run)
				// Blockiert ⇒ der Lieferant ist nicht fertig …
				if (r.zustand === 'wartet-ergebnis') {
					expect(lieferant).toBeDefined()
					expect(lieferant?.zustand).not.toBe('fertig')
				}
				// … und umgekehrt: Lieferant fertig ⇒ niemand wartet auf ihn.
				if (lieferant?.zustand === 'fertig') {
					expect(r.zustand).not.toBe('wartet-ergebnis')
				}
			}
		}
	})

	test('Stepper-Disziplin: der geteilte Baustein ist überall gleich geformt', () => {
		for (const i of intents) {
			for (const r of i.runs) {
				expect(r.schritte.length).toBeGreaterThan(0)
				const current = r.schritte.filter((s) => s.zustand === 'current').length
				if (r.zustand === 'fertig') {
					expect(r.schritte.every((s) => s.zustand === 'done')).toBe(true)
				} else if (r.zustand === 'wartet-ergebnis') {
					// Wer wartet, arbeitet nicht: nichts ist "dran".
					expect(current).toBe(0)
					expect(r.schritte.some((s) => s.zustand === 'blocked')).toBe(true)
				} else {
					expect(current).toBe(1)
				}
			}
		}
	})

	test('der Intent-Status ist abgeleitet, nie gepflegt — und alle drei kommen vor', () => {
		const erwartet: Record<string, string> = {
			'i-081': 'braucht-dich',
			'i-090': 'laeuft',
			'i-069': 'fertig'
		}
		for (const [id, status] of Object.entries(erwartet)) {
			const intent = intents.find((i) => i.id === id)
			expect(intent).toBeDefined()
			if (intent) expect(intentStatus(intent)).toBe(status as ReturnType<typeof intentStatus>)
		}
		expect(new Set(intents.map(intentStatus)).size).toBe(3)
	})

	test('Parallelität kommt vor: ein Intent mit mehreren gleichzeitig aktiven Läufen', () => {
		const aktiv = (z: string) => z !== 'fertig'
		expect(intents.some((i) => i.runs.filter((r) => aktiv(r.zustand)).length >= 2)).toBe(true)
	})

	test('jedes Gesicht ist bekannt — der Rahmen rendert nie ins Leere', () => {
		for (const i of intents) {
			for (const r of i.runs) expect(FACE_KEYS).toContain(r.face)
		}
	})

	test('das Cockpit ist nicht domänen-spezifisch: mehr als eine Sorte Intent', () => {
		// Rechnungen UND eine Sprachnotiz — derselbe Rahmen für beide.
		const faces = new Set(intents.flatMap((i) => i.runs.map((r) => r.face)))
		expect(faces.has('triage')).toBe(true)
		expect(faces.has('buchung')).toBe(true)
	})

	test('Eingang: ein Routing-Vorschlag zeigt auf einen existierenden Intent', () => {
		const ids = new Set(intents.map((i) => i.id))
		for (const e of eingaenge) {
			if (e.vorschlag) expect(ids.has(e.vorschlag.intent)).toBe(true)
		}
	})
})
