import { describe, expect, test } from 'bun:test'
import { recipes } from '../src/lib/fibu/recipe-config'
import { skillFlows, skills } from '../src/lib/fibu/skill-config'

/**
 * Skills are named sets over a FLAT flow registry, plus a contract. What
 * has to hold: every flow belongs somewhere, every entry is a flow of its
 * own skill, and a handoff lands on a skill that actually accepts what the
 * sender provides.
 */

describe('fibu skills', () => {
	const flowIds = new Set(recipes.map((r) => r.id))
	const skillIds = new Set(skills.map((s) => s.id))

	test('every skill names real flows and enters through one of them', () => {
		for (const s of skills) {
			expect(s.flows.length).toBeGreaterThan(0)
			for (const f of s.flows) expect(flowIds.has(f)).toBe(true)
			expect(s.flows).toContain(s.entry)
		}
	})

	test('every flow belongs to at least one skill — the registry has no orphans', () => {
		const claimed = new Set(skills.flatMap((s) => s.flows))
		for (const r of recipes) expect(claimed.has(r.id)).toBe(true)
	})

	test('flows are flat: the registry is one list, skills only reference ids', () => {
		// Ids are unique across the whole registry — a flow exists once, no
		// matter how many skills or subflows point at it.
		expect(new Set(recipes.map((r) => r.id)).size).toBe(recipes.length)
		// Nothing in a skill carries a flow definition; it carries names only.
		for (const s of skills) for (const f of s.flows) expect(typeof f).toBe('string')
		// And the model allows the same flow in several skills — the sets may
		// overlap without anything breaking.
		const overlapping = [...skillIds].map((id) => skills.find((s) => s.id === id)?.flows ?? [])
		expect(overlapping.flat().length).toBeGreaterThanOrEqual(new Set(overlapping.flat()).size)
	})

	test('handoffs cross a real boundary: target exists and accepts what is sent', () => {
		const bySkill = new Map(skills.map((s) => [s.id, s]))
		const owner = (flowId: string) => skills.find((s) => s.flows.includes(flowId))
		let seen = 0
		for (const r of recipes) {
			for (const n of r.nodes) {
				if (n.kind !== 'handoff') {
					expect(n.handoff).toBeUndefined()
					continue
				}
				seen++
				const target = bySkill.get(n.handoff?.skill ?? '')
				expect(target).toBeDefined()
				// A skill never hands off to itself — that would be a subflow.
				expect(target?.id).not.toBe(owner(r.id)?.id)
				// Everything the boundary carries must be something the receiver
				// declared it accepts, and something the sender declared it provides.
				for (const port of n.inputs) {
					expect(target?.accepts).toContain(port.name)
					expect(owner(r.id)?.provides).toContain(port.name)
				}
			}
		}
		// The chain exists at all: inbox → buchhaltung.
		expect(seen).toBeGreaterThan(0)
	})

	test('the skills split the domain: reading, booking, and the human in the loop', () => {
		const inbox = skills.find((s) => s.id === 'inbox')
		const fibu = skills.find((s) => s.id === 'buchhaltung')
		const hitl = skills.find((s) => s.id === 'hitl')
		expect(inbox).toBeDefined()
		expect(fibu).toBeDefined()
		expect(hitl).toBeDefined()
		if (!inbox || !fibu || !hitl) return
		// The inbox owns ingest and reading — triage, extraction, OCR.
		expect(inbox.flows).toEqual(['inbox-triage', 'belege-extrahieren', 'scan-zu-dokument'])
		expect(inbox.entry).toBe('inbox-triage')
		// Booking owns matching and the tax pipeline. The DATEV exchange
		// moved OUT: the month-close runs on the period, not the item, so
		// it is its own skill boundary now.
		expect(fibu.flows).toContain('zahlungsabgleich')
		expect(fibu.flows).toContain('buchungsvorgang')
		expect(fibu.flows).not.toContain('datev-export')
		expect(fibu.entry).toBe('eingangsrechnung-buchen')
		const abschluss = skills.find((s) => s.id === 'abschluss')
		expect(abschluss?.flows).toEqual(['datev-export'])
		expect(abschluss?.entry).toBe('datev-export')
		// And the booking core is BOTH: a subflow inside buchhaltung and a
		// skill of its own — flows are flat, sets may overlap.
		const buchen = skills.find((s) => s.id === 'buchen')
		expect(buchen?.flows).toEqual(['buchungsvorgang'])
		expect(fibu.flows).toContain('buchungsvorgang')
		// But both REMAIN skills OF Buchhaltung: membership is explicit
		// (sub-skill sets), not implied by flow overlap — and every named
		// sub-skill exists in the flat registry.
		expect(fibu.skills).toEqual(['buchen', 'abschluss'])
		for (const u of fibu.skills ?? []) {
			expect(skills.some((x) => x.id === u)).toBe(true)
		}
		// The umbrella's EFFECTIVE flows resolve recursively: the DATEV
		// export is reachable through Buchhaltung again — via its sub-skill.
		expect(skillFlows('buchhaltung', skills)).toContain('datev-export')
		expect(skillFlows('buchhaltung', skills)).toContain('buchungsvorgang')
		// The work contract lines up: positions and transactions flow onward.
		for (const p of ['positionen', 'transaktionen']) expect(fibu.accepts).toContain(p)
		// HITL is generic: it takes the three kinds of interruption from ANY
		// skill and hands back a decision plus the updated actor capability.
		expect(hitl.accepts.sort()).toEqual(['fehler', 'freigabe', 'unklar'])
		expect(hitl.provides).toContain('actor-caps')
		expect(hitl.entry).toBe('hitl-posteingang')
	})

	test('every skill that can interrupt has somewhere to send it', () => {
		const hitl = skills.find((s) => s.id === 'hitl')
		expect(hitl).toBeDefined()
		if (!hitl) return
		// Any skill announcing an interruption must have a handoff that
		// actually delivers it — an unroutable interruption is a dead end.
		for (const s of skills) {
			if (s.id === 'hitl') continue
			const interruptions = s.provides.filter((p) => hitl.accepts.includes(p))
			for (const kind of interruptions) {
				const delivered = recipes
					.filter((r) => s.flows.includes(r.id))
					.some((r) =>
						r.nodes.some(
							(n) => n.handoff?.skill === 'hitl' && n.inputs.some((port) => port.name === kind)
						)
					)
				expect(delivered).toBe(true)
			}
		}
	})

	test('autonomy is earned: anything past hitl carries who signed it and why', () => {
		let promoted = 0
		let supervised = 0
		for (const r of recipes) {
			for (const n of r.nodes) {
				const a = n.autonomie
				// Absent is the strict default — a new actor is supervised.
				if (!a || a.modus === 'hitl') {
					supervised++
					continue
				}
				promoted++
				expect(a.freigabe?.durch).toBeTruthy()
				expect(a.freigabe?.seit).toBeTruthy()
				expect(a.freigabe?.nachweis).toBeTruthy()
			}
		}
		// Both states exist in the data, so the rule is not vacuous.
		expect(promoted).toBeGreaterThan(0)
		expect(supervised).toBeGreaterThan(0)
	})

	test('v1 has no automatic repair: a failure is a message to a person', () => {
		// The escape hatch does not exist yet — every declared failure mode is
		// either a human or a plain retry, and no flow repairs itself.
		for (const r of recipes) {
			for (const n of r.nodes) {
				if (n.autonomie) expect(['hitl', 'retry']).toContain(n.autonomie.fehler)
				expect(n.transform.type).not.toContain('self-repair')
			}
		}
		expect(recipes.some((r) => r.id === 'hitl-fehlerbehandlung')).toBe(false)
	})

	test('the whitelist promotes by hand and demotes by itself', () => {
		const white = recipes.find((r) => r.id === 'hitl-whitelist')
		expect(white).toBeDefined()
		if (!white) return
		// Promotion is a human gate; demotion is deterministic and immediate —
		// trust takes runs to earn and one regression to lose.
		expect(white.nodes.find((n) => n.id === 'freigeben')?.kind).toBe('hitl')
		const demote = white.nodes.find((n) => n.id === 'zuruecksetzen')
		expect(demote?.kind).toBe('transform')
		expect(demote?.transform.config.sofort).toBe(true)
		expect(demote?.autonomie?.modus).toBe('auto')
		// The ledger counts late errors — the metric that contradicts a good
		// throughput number.
		expect(white.nodes.find((n) => n.id === 'bilanz')?.transform.config.kennzahlen).toContain(
			'spaetfehlerquote'
		)
	})
})
