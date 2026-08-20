import { describe, expect, test } from 'bun:test'
import { recipes } from '../src/lib/fibu/recipe-config'
import { skills } from '../src/lib/fibu/skill-config'
import {
	alleLaeufe,
	eingaenge,
	fund,
	type Intent,
	intentStatus,
	intents,
	type SkillRun,
	spur
} from '../src/lib/intents/mock-intents'

/**
 * Der Vertrag des Intent-Cockpits — und zwar gegen die ECHTEN
 * Konfigurationen: jeder Lauf zeigt auf einen Flow der Rezept-Registry,
 * jeder Top-Level-Lauf auf einen konfigurierten Skill, jede
 * Verschachtelung auf einen deklarierten subflow, jede Übergabe auf eine
 * deklarierte Skill-Grenze. Der Mock darf sich nichts ausdenken, was die
 * Registry nicht hergibt — sonst brainstormen wir an der Architektur
 * vorbei.
 */

const rezept = (id: string) => recipes.find((r) => r.id === id)
const tief = intents.flatMap((i) => alleLaeufe(i))

describe('intent cockpit: an den echten Registries verankert', () => {
	test('jeder Lauf (auch verschachtelt) führt einen Flow der Rezept-Registry aus', () => {
		for (const r of tief) {
			const flow = rezept(r.flow)
			expect(flow).toBeDefined()
			// Und die Schritte sind Knoten dieses Flows — der gegangene Pfad,
			// keine erfundenen Etiketten.
			const namen = new Set(flow?.nodes.map((n) => n.name))
			for (const s of r.schritte) expect(namen.has(s.name)).toBe(true)
		}
	})

	test('Top-Level-Läufe sind konfigurierte Skills, und der Flow gehört zum Skill', () => {
		for (const i of intents) {
			for (const r of i.runs) {
				const skill = skills.find((s) => s.id === r.skillId)
				expect(skill).toBeDefined()
				expect(skill?.flows).toContain(r.flow)
			}
		}
	})

	test('Verschachtelung ist deklarierte Komposition: alsSchritt ⇒ subflow im Rezept', () => {
		const pruefe = (eltern: SkillRun) => {
			for (const kind of eltern.unter ?? []) {
				// Der Schritt existiert im Eltern-Lauf …
				expect(eltern.schritte.map((s) => s.name)).toContain(kind.alsSchritt)
				// … und der Eltern-FLOW deklariert dort genau diesen Subflow.
				const knoten = rezept(eltern.flow)?.nodes.find((n) => n.name === kind.alsSchritt)
				expect(knoten?.kind).toBe('subflow')
				expect(knoten?.subflow?.recipe).toBe(kind.flow)
				pruefe(kind)
			}
		}
		for (const i of intents) for (const r of i.runs) pruefe(r)
	})

	test('die Komposition ist wirklich rekursiv: mindestens eine Kette über zwei Ebenen', () => {
		expect(tief.some((r) => r.unter?.some((u) => (u.unter?.length ?? 0) > 0))).toBe(true)
	})

	test('Übergaben sind deklarierte Skill-Grenzen: braucht ⇒ handoff im Liefer-Flow', () => {
		for (const i of intents) {
			for (const r of i.runs) {
				if (!r.braucht?.run) continue
				const lieferant = i.runs.find((x) => x.id === r.braucht?.run)
				expect(lieferant).toBeDefined()
				if (!lieferant || lieferant.skillId === r.skillId) continue
				const grenze = rezept(lieferant.flow)?.nodes.find(
					(n) => n.kind === 'handoff' && n.handoff?.skill === r.skillId
				)
				expect(grenze).toBeDefined()
			}
		}
	})

	test('der Monat wartet auf GANZE Intents — Belege sind Intents, der Monat auch', () => {
		const monat = intents.find((i) => i.id === 'i-monat')
		const exportRun = monat?.runs.find((r) => r.flow === 'datev-export')
		expect(exportRun?.braucht?.intents).toBeDefined()
		const ids = new Set(intents.map((i) => i.id))
		for (const ref of exportRun?.braucht?.intents ?? []) {
			expect(ids.has(ref)).toBe(true)
			// Und niemals zirkulär: der Monat wartet nicht auf sich selbst.
			expect(ref).not.toBe('i-monat')
		}
		// Solange auch nur ein gespeister Intent offen ist, wartet der Monat.
		const speiser = (exportRun?.braucht?.intents ?? []).map((ref) =>
			intents.find((i) => i.id === ref)
		)
		expect(speiser.some((i) => i && intentStatus(i) !== 'fertig')).toBe(true)
		expect(exportRun?.zustand).toBe('wartet-ergebnis')
	})

	test('der Kontoauszug nimmt den CSV-Pfad durch DENSELBEN Inbox-Flow', () => {
		const inbox = intents.find((i) => i.id === 'i-auszug')?.runs.find((r) => r.skillId === 'inbox')
		expect(inbox?.flow).toBe('inbox-triage')
		const namen = inbox?.schritte.map((st) => st.name) ?? []
		expect(namen).toContain('Auszugsweiche')
		expect(namen).toContain('CSV parsen')
		// Der Beleg-Zweig bleibt unbetreten: ein Flow, zwei Pfade.
		expect(namen).not.toContain('Belege extrahieren')
	})

	test('wartet-ergebnis heißt: das Gebrauchte liegt wirklich noch nicht vor', () => {
		for (const i of intents) {
			for (const r of i.runs) {
				if (r.braucht?.intents) {
					// Intent-weite Abhängigkeit: blockiert genau dann, wenn
					// mindestens ein gespeister Intent noch offen ist.
					const offen = r.braucht.intents.some((ref) => {
						const ziel = intents.find((x) => x.id === ref)
						return ziel !== undefined && intentStatus(ziel) !== 'fertig'
					})
					expect(r.zustand === 'wartet-ergebnis').toBe(offen)
					continue
				}
				const lieferant = i.runs.find((x) => x.id === r.braucht?.run)
				if (r.zustand === 'wartet-ergebnis') {
					expect(lieferant).toBeDefined()
					expect(lieferant?.zustand).not.toBe('fertig')
				}
				if (lieferant?.zustand === 'fertig') {
					expect(r.zustand).not.toBe('wartet-ergebnis')
				}
			}
		}
	})

	test('Warten steigt auf: ein Kind bei einem Menschen hält auch den Eltern-Lauf', () => {
		const pruefe = (eltern: SkillRun) => {
			for (const kind of eltern.unter ?? []) {
				if (kind.zustand === 'wartet-mensch') expect(eltern.zustand).toBe('wartet-mensch')
				if (kind.zustand !== 'fertig') expect(eltern.zustand).not.toBe('fertig')
				pruefe(kind)
			}
		}
		for (const i of intents) for (const r of i.runs) pruefe(r)
	})

	test('Stepper-Disziplin: der geteilte Baustein ist überall gleich geformt', () => {
		for (const r of tief) {
			expect(r.schritte.length).toBeGreaterThan(0)
			const current = r.schritte.filter((s) => s.zustand === 'current').length
			if (r.zustand === 'fertig') {
				expect(r.schritte.every((s) => s.zustand === 'done')).toBe(true)
			} else if (r.zustand === 'wartet-ergebnis') {
				expect(current).toBe(0)
				expect(r.schritte.some((s) => s.zustand === 'blocked')).toBe(true)
			} else {
				expect(current).toBe(1)
			}
		}
	})

	test('der Intent-Status ist abgeleitet, nie gepflegt — und alle drei kommen vor', () => {
		const erwartet: Record<string, ReturnType<typeof intentStatus>> = {
			'i-mueller': 'braucht-dich',
			'i-bergmann': 'laeuft',
			'i-weber': 'fertig'
		}
		for (const [id, status] of Object.entries(erwartet)) {
			const intent = intents.find((i) => i.id === id)
			expect(intent).toBeDefined()
			if (intent) expect(intentStatus(intent)).toBe(status)
		}
		expect(new Set(intents.map(intentStatus)).size).toBe(3)
	})

	test('die Spur drückt Tiefe zu einem Pfad platt — bis zum arbeitenden Blatt', () => {
		// Bergmann: drei Ebenen Komposition ⇒ drei Pfadglieder, Blatt zuletzt.
		const inbox = intents
			.find((i) => i.id === 'i-bergmann')
			?.runs.find((r) => r.skillId === 'inbox')
		expect(inbox).toBeDefined()
		if (!inbox) return
		expect(spur(inbox).pfad).toEqual(['Belege extrahieren', 'Scan lesen', 'Vision-OCR'])
		// Und generell: wer arbeitet oder auf einen Menschen wartet, hat
		// einen nicht-leeren Pfad; wer fertig ist, hat keinen.
		for (const i of intents) {
			for (const r of i.runs) {
				const p = spur(r).pfad
				if (r.zustand === 'laeuft' || r.zustand === 'wartet-mensch') {
					expect(p.length).toBeGreaterThan(0)
				}
				if (r.zustand === 'fertig') expect(p.length).toBe(0)
			}
		}
	})

	test('fund() holt die Fakten der Blätter an die Karte', () => {
		// Die Buchungszeilen liegen im verschachtelten Buchungsvorgang —
		// die Karte fragt den Baum, nicht eine zweite Datenablage.
		const buchhaltung = intents
			.find((i) => i.id === 'i-mueller')
			?.runs.find((r) => r.skillId === 'buchhaltung')
		expect(buchhaltung).toBeDefined()
		if (!buchhaltung) return
		expect(buchhaltung.daten?.zeilen).toBeUndefined()
		expect(fund(buchhaltung, 'zeilen')).toBeDefined()
		expect(fund<boolean>(buchhaltung, 'festschreibbar')).toBe(true)
	})
	test('das Cockpit ist nicht domänen-spezifisch: vier verschiedene Skills arbeiten', () => {
		const beteiligte = new Set(intents.flatMap((i) => i.runs.map((r) => r.skillId)))
		for (const s of ['inbox', 'buchhaltung', 'hitl', 'intents']) {
			expect(beteiligte.has(s)).toBe(true)
		}
	})

	test('Eingang: ein Routing-Vorschlag zeigt auf einen existierenden Intent', () => {
		const ids = new Set(intents.map((i: Intent) => i.id))
		for (const e of eingaenge) {
			if (e.vorschlag) expect(ids.has(e.vorschlag.intent)).toBe(true)
		}
	})
})
