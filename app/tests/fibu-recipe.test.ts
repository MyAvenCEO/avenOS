import { describe, expect, test } from 'bun:test'
import { recipes } from '../src/lib/fibu/recipe-config'
import { layoutRecipe } from '../src/lib/fibu/recipe-layout'

/**
 * A recipe must be a well-formed dataflow before any engine exists: every
 * edge lands on a declared port, sources only emit, sinks only receive,
 * the graph is acyclic, no step dangles unreachable — and the extended
 * semantics hold: multi-fed ports are either/or, routes actually branch,
 * subflow refs resolve, the tax layer carries no LLM, and everything
 * enters through the one inbox.
 */

describe('fibu recipes', () => {
	test('every edge connects declared ports on existing nodes', () => {
		for (const r of recipes) {
			const byId = new Map(r.nodes.map((n) => [n.id, n]))
			for (const e of r.edges) {
				const from = byId.get(e.from)
				const to = byId.get(e.to)
				expect(from).toBeDefined()
				expect(to).toBeDefined()
				expect(from?.outputs.map((p) => p.name)).toContain(e.fromPort)
				expect(to?.inputs.map((p) => p.name)).toContain(e.toPort)
			}
		}
	})

	test('inputs only emit, outputs only receive, routes branch, the rest do both', () => {
		for (const r of recipes) {
			for (const n of r.nodes) {
				if (n.kind === 'input') {
					expect(n.inputs.length).toBe(0)
					expect(n.outputs.length).toBeGreaterThan(0)
				} else if (n.kind === 'output' || n.kind === 'handoff') {
					expect(n.outputs.length).toBe(0)
					expect(n.inputs.length).toBeGreaterThan(0)
				} else {
					expect(n.inputs.length).toBeGreaterThan(0)
					expect(n.outputs.length).toBeGreaterThan(0)
					// A switch with fewer than two branches routes nothing.
					if (n.kind === 'route') expect(n.outputs.length).toBeGreaterThanOrEqual(2)
				}
			}
		}
	})

	test('a port fed by more than one edge is declared either/or (any)', () => {
		for (const r of recipes) {
			const byId = new Map(r.nodes.map((n) => [n.id, n]))
			const fanIn = new Map<string, number>()
			for (const e of r.edges) {
				const key = `${e.to}.${e.toPort}`
				fanIn.set(key, (fanIn.get(key) ?? 0) + 1)
			}
			for (const [key, count] of fanIn) {
				if (count > 1) {
					const [nodeId, portName] = key.split('.')
					const port = byId.get(nodeId)?.inputs.find((p) => p.name === portName)
					expect(port?.mode).toBe('any')
				}
			}
		}
	})

	test('subflow refs resolve, and their portMap docks onto real input/output nodes', () => {
		const byId = new Map(recipes.map((r) => [r.id, r]))
		for (const r of recipes) {
			for (const n of r.nodes) {
				if (n.kind !== 'subflow') {
					expect(n.subflow).toBeUndefined()
					continue
				}
				const sub = byId.get(n.subflow?.recipe ?? '')
				expect(sub).toBeDefined()
				if (!sub || !n.subflow) continue
				const subNodes = new Map(sub.nodes.map((s) => [s.id, s]))
				// Every declared port maps to a node of the matching boundary kind.
				for (const port of n.inputs) {
					const target = subNodes.get(n.subflow.portMap.inputs[port.name])
					expect(target?.kind).toBe('input')
				}
				for (const port of n.outputs) {
					const target = subNodes.get(n.subflow.portMap.outputs[port.name])
					expect(target?.kind).toBe('output')
				}
			}
		}
	})

	test('composite–leaf: the reference graph is an acyclic DAG, four levels deep', () => {
		const byId = new Map(recipes.map((r) => [r.id, r]))
		const refs = (id: string): string[] =>
			(byId.get(id)?.nodes ?? [])
				.filter((n) => n.kind === 'subflow')
				.map((n) => n.subflow?.recipe ?? '')
		// No cycles anywhere in the reference graph — nesting must bottom out.
		const state = new Map<string, 'visiting' | 'done'>()
		const visit = (id: string): boolean => {
			if (state.get(id) === 'done') return true
			if (state.get(id) === 'visiting') return false
			state.set(id, 'visiting')
			for (const next of refs(id)) if (!visit(next)) return false
			state.set(id, 'done')
			return true
		}
		for (const r of recipes) expect(visit(r.id)).toBe(true)
		// Inbox: triage → extraction → OCR leaf. The booking flows are NOT
		// nested here — the triage hands off across the skill boundary.
		expect(refs('inbox-triage')).toEqual(['belege-extrahieren', 'scan-zu-dokument'])
		expect(refs('belege-extrahieren')).toContain('scan-zu-dokument')
		expect(refs('scan-zu-dokument')).toEqual([])
		expect(refs('inbox-triage')).not.toContain('eingangsrechnung-buchen')
		// Buchhaltung: the bracket over its two halves; both are leaves.
		expect(refs('eingangsrechnung-buchen')).toEqual(['zahlungsabgleich', 'buchungsvorgang'])
		expect(refs('zahlungsabgleich')).toEqual([])
		expect(refs('buchungsvorgang')).toEqual([])
		// DATEV export composes nothing and nobody composes it.
		expect(refs('datev-export')).toEqual([])
		for (const r of recipes) expect(refs(r.id)).not.toContain('datev-export')
	})

	test('the graph is acyclic', () => {
		for (const r of recipes) {
			const out = new Map<string, string[]>()
			for (const e of r.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to])
			const state = new Map<string, 'visiting' | 'done'>()
			const visit = (id: string): boolean => {
				if (state.get(id) === 'done') return true
				if (state.get(id) === 'visiting') return false
				state.set(id, 'visiting')
				for (const next of out.get(id) ?? []) if (!visit(next)) return false
				state.set(id, 'done')
				return true
			}
			for (const n of r.nodes) expect(visit(n.id)).toBe(true)
		}
	})

	test('every node is reachable from an input and reaches an output', () => {
		for (const r of recipes) {
			const forward = new Map<string, string[]>()
			const backward = new Map<string, string[]>()
			for (const e of r.edges) {
				forward.set(e.from, [...(forward.get(e.from) ?? []), e.to])
				backward.set(e.to, [...(backward.get(e.to) ?? []), e.from])
			}
			const flood = (starts: string[], adj: Map<string, string[]>): Set<string> => {
				const seen = new Set(starts)
				const queue = [...starts]
				while (queue.length > 0) {
					const id = queue.pop() as string
					for (const next of adj.get(id) ?? []) {
						if (!seen.has(next)) {
							seen.add(next)
							queue.push(next)
						}
					}
				}
				return seen
			}
			const fromInputs = flood(
				r.nodes.filter((n) => n.kind === 'input').map((n) => n.id),
				forward
			)
			const toOutputs = flood(
				r.nodes.filter((n) => n.kind === 'output' || n.kind === 'handoff').map((n) => n.id),
				backward
			)
			for (const n of r.nodes) {
				expect(fromInputs.has(n.id)).toBe(true)
				expect(toOutputs.has(n.id)).toBe(true)
			}
		}
	})

	test('layout is derived, not authored: one level per canvas, edges run forward', () => {
		for (const r of recipes) {
			const laid = layoutRecipe(r)
			// Every node of THIS recipe, and nothing from a subflow — one flow
			// per screen; the innards live on their own canvas.
			expect(laid.nodes.map((n) => n.id).sort()).toEqual(r.nodes.map((n) => n.id).sort())
			const at = new Map(laid.nodes.map((n) => [n.id, n.position]))
			// Columns come from graph depth, so every edge points rightward —
			// no backward arrows, whatever the declaration order was.
			for (const e of laid.edges) {
				const from = at.get(e.source)
				const to = at.get(e.target)
				expect(from).toBeDefined()
				expect(to).toBeDefined()
				expect((from?.x ?? 0) < (to?.x ?? 0)).toBe(true)
			}
			// Inputs share the leftmost column; nothing sits left of them.
			const leftmost = Math.min(...laid.nodes.map((n) => n.position.x))
			for (const n of laid.nodes) {
				if (n.node.kind === 'input') expect(n.position.x).toBe(leftmost)
			}
			// No two nodes land on the same spot.
			const spots = laid.nodes.map((n) => `${n.position.x}:${n.position.y}`)
			expect(new Set(spots).size).toBe(spots.length)
		}
	})

	test('the split holds: the generic half knows no tax, the tax half no intake', () => {
		const generic = recipes.find((x) => x.id === 'zahlungsabgleich')
		const tax = recipes.find((x) => x.id === 'buchungsvorgang')
		const bracket = recipes.find((x) => x.id === 'eingangsrechnung-buchen')
		expect(generic).toBeDefined()
		expect(tax).toBeDefined()
		expect(bracket).toBeDefined()
		if (!generic || !tax || !bracket) return
		// Matching lives in the generic half — and nothing German-tax.
		expect(generic.nodes.map((n) => n.id)).toContain('match')
		for (const n of generic.nodes) {
			expect(n.transform.type.startsWith('rules:tax')).toBe(false)
			expect(n.kind).not.toBe('hitl')
		}
		// Tax logic, line derivation and the seal live in the tax half — and it
		// takes no documents, only positions and matched payments.
		expect(tax.nodes.map((n) => n.id)).toEqual(
			expect.arrayContaining(['tax', 'derive', 'festschreiben', 'hitl-gf', 'hitl-buchhalter'])
		)
		for (const n of tax.nodes.filter((x) => x.kind === 'input')) {
			expect(n.transform.type).not.toContain('document')
		}
		// The bracket is just that: two subflows and a wire between them.
		expect(bracket.nodes.filter((n) => n.kind === 'subflow').map((n) => n.id)).toEqual([
			'abgleichen',
			'buchen'
		])
		expect(
			bracket.edges.some(
				(e) => e.from === 'abgleichen' && e.fromPort === 'abgeglichen' && e.to === 'buchen'
			)
		).toBe(true)
		// Transactions arrive from the inbox skill or straight from the bank.
		const match = generic.nodes.find((n) => n.id === 'match')
		expect(match?.inputs.find((p) => p.name === 'transaktionen')?.mode).toBe('any')
		expect(
			generic.edges.filter((e) => e.to === 'match' && e.toPort === 'transaktionen').length
		).toBe(2)
		// Open items are read as state, never wired from the tax half — that is
		// what keeps the two halves a DAG instead of a loop.
		expect(generic.nodes.find((n) => n.id === 'in-opos')?.kind).toBe('input')
		expect(tax.nodes.find((n) => n.id === 'out-opos')?.kind).toBe('output')
	})

	test('the tax half is deterministic where it must be', () => {
		const r = recipes.find((x) => x.id === 'buchungsvorgang')
		expect(r).toBeDefined()
		if (!r) return
		// The tax layer is deterministic — rules type AND no LLM block, ever.
		const tax = r.nodes.find((n) => n.id === 'tax')
		expect(tax?.transform.type.startsWith('rules:')).toBe(true)
		expect(tax?.llm).toBeUndefined()
		// The classifier must never output Konto or BU — that is the rules layer's job.
		const classify = r.nodes.find((n) => n.id === 'classify')
		expect(classify?.transform.config.neverOutputs).toEqual(['konto', 'bu'])
		expect(classify?.llm).toBeDefined()
	})

	test('Vier-Augen-Festschreibung: GF → Buchhalter → Hash-Kette mit Blockchain-Anker', () => {
		const r = recipes.find((x) => x.id === 'buchungsvorgang')
		expect(r).toBeDefined()
		if (!r) return
		// Two human gates, in declared order — and they are hitl-kind, not transforms.
		const gf = r.nodes.find((n) => n.id === 'hitl-gf')
		const bh = r.nodes.find((n) => n.id === 'hitl-buchhalter')
		expect(gf?.kind).toBe('hitl')
		expect(bh?.kind).toBe('hitl')
		expect(gf?.transform.config.reihenfolge).toBe(1)
		expect(bh?.transform.config.reihenfolge).toBe(2)
		// The chain is wired gate → gate → seal → batch; nothing bypasses it.
		const edge = (from: string, to: string) => r.edges.some((e) => e.from === from && e.to === to)
		expect(edge('validate', 'hitl-gf')).toBe(true)
		expect(edge('hitl-gf', 'hitl-buchhalter')).toBe(true)
		expect(edge('hitl-buchhalter', 'festschreiben')).toBe(true)
		expect(edge('festschreiben', 'out-stapel')).toBe(true)
		expect(edge('validate', 'out-stapel')).toBe(false)
		// The seal is deterministic and anchored.
		const seal = r.nodes.find((n) => n.id === 'festschreiben')
		expect(seal?.transform.config.anchor).toBe('blockchain')
		expect(seal?.transform.config.hashkette).toBe(true)
		expect(seal?.llm).toBeUndefined()
	})

	test('Ist-Versteuerung: Policy-Weiche im Zahlungsstrom, USt wird erst mit der Zahlung fällig', () => {
		const r = recipes.find((x) => x.id === 'buchungsvorgang')
		expect(r).toBeDefined()
		if (!r) return
		const weiche = r.nodes.find((n) => n.id === 'versteuerung')
		expect(weiche?.kind).toBe('route')
		expect(weiche?.outputs.map((p) => p.name)).toEqual(['soll', 'ist'])
		expect(weiche?.transform.config.paragraph).toBe('§ 20 UStG')
		// The ist branch re-books tax on payment, deterministically, and its
		// Umbuchung flows into the seal — the seal port is an either/or merge.
		const umbuchen = r.nodes.find((n) => n.id === 'ust-umbuchen')
		expect(umbuchen?.llm).toBeUndefined()
		expect(r.edges.some((e) => e.from === 'versteuerung' && e.to === 'ust-umbuchen')).toBe(true)
		expect(r.edges.some((e) => e.from === 'ust-umbuchen' && e.to === 'festschreiben')).toBe(true)
		expect(
			r.nodes.find((n) => n.id === 'festschreiben')?.inputs.find((p) => p.name === 'freigegeben')
				?.mode
		).toBe('any')
	})

	test('one OCR flow, many document types: schema and prompt come from the type', () => {
		const leaf = recipes.find((x) => x.id === 'scan-zu-dokument')
		expect(leaf).toBeDefined()
		if (!leaf) return
		// The leaf takes image AND type, and returns data AND text.
		expect(leaf.nodes.find((n) => n.id === 'in-typ')?.kind).toBe('input')
		const ocr = leaf.nodes.find((n) => n.id === 'ocr')
		expect(ocr?.outputs.map((p) => p.name)).toEqual(['daten', 'text'])
		expect(ocr?.llm).toBeDefined()
		// The type resolves to schema + prompt in a deterministic registry —
		// a new document type is a registry entry, not a new flow.
		const registry = leaf.nodes.find((n) => n.id === 'schema-waehlen')
		expect(registry?.llm).toBeUndefined()
		expect(Object.keys(registry?.transform.config.registry as object)).toContain('kontoauszug')
		// The SAME leaf is reused for invoices and for bank statements, and
		// both are fed a document type.
		const users = recipes.flatMap((r) =>
			r.nodes
				.filter((n) => n.subflow?.recipe === 'scan-zu-dokument')
				.map((n) => ({ recipe: r, node: n }))
		)
		expect(users.map((u) => `${u.recipe.id}/${u.node.id}`).sort()).toEqual([
			'belege-extrahieren/ocr',
			'inbox-triage/auszug-ocr'
		])
		for (const u of users) {
			expect(u.node.inputs.map((p) => p.name)).toContain('typ')
			expect(u.recipe.edges.some((e) => e.to === u.node.id && e.toPort === 'typ')).toBe(true)
		}
	})

	test('DATEV export is its own system: reads sealed state, folds tax back into BU keys', () => {
		const r = recipes.find((x) => x.id === 'datev-export')
		expect(r).toBeDefined()
		if (!r) return
		// It reads the ledger as state — only sealed entries, never drafts.
		const source = r.nodes.find((n) => n.id === 'in-buchungen')
		expect(source?.transform.config.nurFestgeschrieben).toBe(true)
		// The accordion: our explicit Vorsteuer lines become BU keys on gross
		// amounts, because that is all EXTF can carry.
		const fold = r.nodes.find((n) => n.id === 'falten')
		expect(fold?.llm).toBeUndefined()
		expect(fold?.transform.config.bu).toEqual({ '19': 9, '7': 8 })
		// Batches never cross the fiscal year, and the format is pinned.
		expect(r.nodes.find((n) => n.id === 'stapeln')?.transform.config.grenze).toBe('wirtschaftsjahr')
		const writer = r.nodes.find((n) => n.id === 'schreiben')
		expect(writer?.transform.config.version).toBe(700)
		expect(writer?.transform.config.encoding).toBe('windows-1252')
		expect(writer?.transform.config.belegdatum).toBe('TTMM')
		// A rejected transfer must reach a human, not a log file.
		expect(r.nodes.find((n) => n.id === 'out-abweisung')?.handoff?.skill).toBe('hitl')
	})

	test('extraction routes with priority fallbacks into one either/or sink', () => {
		const r = recipes.find((x) => x.id === 'belege-extrahieren')
		expect(r).toBeDefined()
		if (!r) return
		const weiche = r.nodes.find((n) => n.kind === 'route')
		expect(weiche?.outputs.map((p) => p.name)).toEqual(['e-rechnung', 'pdf-text', 'scan'])
		// The structured parser is deterministic; the scan path is the OCR
		// subflow whose schema-conform data goes straight into the merge.
		expect(r.nodes.find((n) => n.id === 'parse-erechnung')?.llm).toBeUndefined()
		expect(r.nodes.find((n) => n.id === 'ocr')?.subflow?.recipe).toBe('scan-zu-dokument')
		expect(r.edges.some((e) => e.from === 'ocr' && e.fromPort === 'daten')).toBe(true)
		expect(r.nodes.find((n) => n.id === 'parse-pdf')?.llm).toBeDefined()
		// All three paths merge on one either/or port.
		const sink = r.nodes.find((n) => n.id === 'out-positionen')
		expect(sink?.inputs.find((p) => p.name === 'positionen')?.mode).toBe('any')
		expect(r.edges.filter((e) => e.to === 'out-positionen').length).toBe(3)
	})

	test('Inbox-Triage is the root: three sources, one classification, built routes only', () => {
		const r = recipes.find((x) => x.id === 'inbox-triage')
		expect(r).toBeDefined()
		if (!r) return
		expect(r.nodes.filter((n) => n.kind === 'input').length).toBe(3)
		// All sources merge into one either/or intake.
		expect(
			r.nodes.find((n) => n.id === 'annehmen')?.inputs.find((p) => p.name === 'eingang')?.mode
		).toBe('any')
		// Split and classify are LLM steps with the honesty constraints.
		expect(r.nodes.find((n) => n.id === 'trennen')?.llm).toBeDefined()
		const klass = r.nodes.find((n) => n.id === 'klassifizieren')
		expect(klass?.llm?.constraints).toContain('unter Schwelle → unbekannt, nie raten')
		// The one classification emits the document type that travels downstream.
		expect(klass?.outputs.map((p) => p.name)).toEqual(['klassifiziert', 'dokumenttyp'])
		expect(r.edges.some((e) => e.from === 'klassifizieren' && e.fromPort === 'dokumenttyp')).toBe(
			true
		)
		// Only routes that actually lead somewhere: every announced class has a
		// branch, and nothing is announced that we have not built.
		const triage = r.nodes.find((n) => n.id === 'triage')
		expect(triage?.outputs.map((p) => p.name)).toEqual(['beleg', 'transaktionen', 'unbekannt'])
		expect(klass?.transform.config.klassen).toEqual(['beleg', 'transaktionen'])
		// The inbox READS both branches itself — extraction for Belege, the OCR
		// flow for Auszüge — and only then hands structured data over.
		expect(r.nodes.find((n) => n.id === 'extract')?.subflow?.recipe).toBe('belege-extrahieren')
		expect(r.nodes.find((n) => n.id === 'auszug-ocr')?.subflow?.recipe).toBe('scan-zu-dokument')
		const uebergabe = r.nodes.find((n) => n.id === 'an-buchhaltung')
		expect(uebergabe?.handoff?.skill).toBe('buchhaltung')
		expect(uebergabe?.inputs.map((p) => p.name)).toEqual(['positionen', 'transaktionen'])
		// Anything unplaceable goes straight to a human.
		expect(r.nodes.find((n) => n.id === 'an-hitl')?.handoff?.skill).toBe('hitl')
		// No placeholder sinks for flows that do not exist yet — an unbuilt
		// path is a human in the loop, not a box that swallows work.
		for (const n of r.nodes) {
			expect(String(n.transform.config.ziel ?? '')).not.toContain('folgt')
		}
	})
})
