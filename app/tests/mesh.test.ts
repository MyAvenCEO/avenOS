import { describe, expect, test } from 'bun:test'
import { doors, layoutCoordinator } from '../src/lib/mesh/mesh-layout'
import { type Actor, ask, edges, find } from '../src/lib/mesh/model'
import { registry } from '../src/lib/mesh/registry'

/**
 * The contracts of the collapsed DECLARATION model — one primitive
 * (Actor), wiring derived from provides ∩ requires, ask() answering
 * from the manifest. The instance side (threads, run/state/board) was
 * removed with the Intents cockpit (0141); these are the claims the
 * Skills canvas still stands on.
 */

const actors: Actor[] = registry

describe('mesh: one primitive, coordinators are actors with members', () => {
	test('every member reference resolves, and a coordinator has members', () => {
		for (const a of registry) {
			for (const m of a.members ?? []) expect(find(actors, m)).toBeDefined()
		}
		expect(registry.some((a) => (a.members?.length ?? 0) > 0)).toBe(true)
		expect(registry.some((a) => !a.members)).toBe(true)
	})

	test('ask(): every actor answers from its manifest — the abject fallback', () => {
		for (const a of actors) {
			const answer = ask(a)
			expect(answer.length).toBeGreaterThan(0)
			expect(answer).toContain(a.manifest.name)
		}
	})

	test('terminology is english, functor-style — no legacy umlauts in the model', () => {
		const surface = JSON.stringify({
			ids: actors.map((a) => a.id),
			functors: actors.flatMap((a) => [
				...(a.manifest.requires ?? []),
				...(a.manifest.provides ?? [])
			])
		})
		expect(/[äöüß]/i.test(surface)).toBe(false)
	})
})

describe('mesh: the wiring is derived, never stored', () => {
	test('edges are provides ∩ requires — never stored', () => {
		for (const a of registry) expect('edges' in a).toBe(false)
		// The full intake lane: three sources feed accept, cases split,
		// classify, triage — and the statement branch has its own switch.
		const inbox = edges(actors, 'inbox')
		expect(inbox).toContainEqual({ from: 'mail', to: 'accept', functor: 'intake' })
		expect(inbox).toContainEqual({ from: 'upload-src', to: 'accept', functor: 'intake' })
		expect(inbox).toContainEqual({ from: 'accept', to: 'split', functor: 'item' })
		expect(inbox).toContainEqual({ from: 'split', to: 'classify-item', functor: 'case' })
		expect(inbox).toContainEqual({ from: 'classify-item', to: 'triage', functor: 'class' })
		expect(inbox).toContainEqual({ from: 'triage', to: 'extract', functor: 'document' })
		expect(inbox).toContainEqual({ from: 'triage', to: 'statement-route', functor: 'statement' })
		expect(inbox).toContainEqual({ from: 'statement-route', to: 'parse-csv', functor: 'csv-file' })
		// Inside extract: the format switch fans into three reads; the scan
		// read is its own colony whose reading gets shaped.
		const ex = edges(actors, 'extract')
		expect(ex).toContainEqual({ from: 'doc-route', to: 'parse-einvoice', functor: 'e-invoice' })
		expect(ex).toContainEqual({ from: 'doc-route', to: 'read-scan', functor: 'scan' })
		expect(ex).toContainEqual({ from: 'read-scan', to: 'shape-positions', functor: 'reading' })
		// Inside book: tax logic feeds the lines, validation feeds BOTH
		// approvals, and only the bookkeeper's approval reaches the lock.
		const book = edges(actors, 'book')
		expect(book).toContainEqual({ from: 'classify-cost', to: 'tax', functor: 'category' })
		expect(book).toContainEqual({ from: 'tax', to: 'derive-lines', functor: 'tax-set' })
		expect(book).toContainEqual({ from: 'validate', to: 'approve-gf', functor: 'valid' })
		expect(book).toContainEqual({ from: 'validate', to: 'approve', functor: 'valid' })
		expect(book).toContainEqual({ from: 'approve', to: 'lock', functor: 'approval' })
		expect(book).toContainEqual({ from: 'validate', to: 'tax-route', functor: 'valid' })
		expect(book).toContainEqual({ from: 'tax-route', to: 'vat-due', functor: 'cash' })
		// And the whitelist loop exists: autonomy is earned, per actor.
		const wl = edges(actors, 'whitelist')
		expect(wl).toContainEqual({ from: 'balance', to: 'review', functor: 'record' })
		expect(wl).toContainEqual({ from: 'review', to: 'promote', functor: 'ready' })
		expect(wl).toContainEqual({ from: 'review', to: 'demote', functor: 'slipping' })
	})
})

describe('mesh: the canvas draws the derivation', () => {
	const coordinators = registry.filter((a) => (a.members?.length ?? 0) > 0)
	const roots = coordinators.filter((c) => !coordinators.some((o) => o.members?.includes(c.id)))

	test('every member placed, every wire inferred, only doors beyond', () => {
		for (const c of coordinators) {
			const laid = layoutCoordinator(registry, c.id, roots)
			const ids = new Set(laid.nodes.map((n) => n.id))
			for (const m of c.members ?? []) expect(ids.has(m)).toBe(true)
			for (const e of laid.edges) {
				expect(ids.has(e.source)).toBe(true)
				expect(ids.has(e.target)).toBe(true)
			}
			for (const n of laid.nodes) {
				if (!c.members?.includes(n.id)) expect(n.id.startsWith('door:')).toBe(true)
			}
		}
	})

	test('the old handoffs reappear as inferences: skill boundaries are doors', () => {
		const to = (from: string) => doors(registry, from, roots).map((d) => d.to.id)
		// The inbox hands positions/transactions to accounting and the
		// unknown to the human desk — nobody stored these boundaries.
		expect(to('inbox')).toContain('accounting')
		expect(to('inbox')).toContain('human-desk')
		// Accounting hands locked bookings to the month close.
		expect(to('accounting')).toContain('close')
		// The desk's decisions feed the whitelist: autonomy is earned.
		expect(to('human-desk')).toContain('whitelist')
	})
})
