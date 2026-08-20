import { describe, expect, test } from 'bun:test'
import { doors, layoutCoordinator } from '../src/lib/mesh/mesh-layout'
import {
	actorState,
	ask,
	board,
	delivered,
	edges,
	engaged,
	faceState,
	find,
	intentState,
	memberState,
	needs,
	openAsks,
	path,
	subtree,
	YOU
} from '../src/lib/mesh/model'
import { registry } from '../src/lib/mesh/registry'
import { intents, loose, threads } from '../src/lib/mesh/threads'

/**
 * The contracts of the collapsed model: ONE primitive (Actor), ONE
 * relation (Message), everything else derived. These tests are the
 * first-principles claims themselves — if one breaks, the collapse
 * leaked a second mechanism back in.
 */

const actors = [...registry, ...intents]
const log = (id: string) => threads.find((t) => t.intent === id)?.log ?? []

describe('mesh: one primitive, three gestalts', () => {
	test('every member reference resolves, and composition has no cycles', () => {
		for (const a of registry) {
			for (const m of a.members ?? []) expect(find(actors, m)).toBeDefined()
			// subtree terminates and contains itself — the seen-set holds.
			expect(subtree(actors, a.id)).toContain(a.id)
		}
	})

	test('gestalts are fields, not types: coordinators have members, intents are born', () => {
		expect(registry.some((a) => (a.members?.length ?? 0) > 0)).toBe(true)
		expect(registry.some((a) => !a.members)).toBe(true)
		for (const i of intents) expect(i.born).toBeDefined()
		// And an intent-shaped actor lives in the SAME type as a worker.
		expect(intents.every((i) => typeof i.id === 'string' && i.manifest !== undefined)).toBe(true)
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

describe('mesh: everything else is derived', () => {
	test('edges are provides ∩ requires — never stored', () => {
		// No actor carries an edge list; the graph emerges.
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

	test('needs = requires − delivered: an open requirement IS an open ask', () => {
		// Fresh invoice: nothing delivered yet — accounting still needs both.
		expect(needs(actors, 'accounting', log('i-fresh'))).toEqual(['positions', 'transactions'])
		// Müller: positions and match were delivered IN THIS thread; the
		// transactions came from another intent (the bank statement) — so
		// within this thread they honestly remain an undelivered declared
		// need. Cross-intent facts arrive as messages, like everything.
		expect(needs(actors, 'accounting', log('i-mueller'))).toEqual(['transactions'])
		expect(delivered(log('i-mueller')).has('positions')).toBe(true)
	})

	test('states are read off the thread, never stored', () => {
		expect(intentState(actors, 'i-mueller', log('i-mueller'))).toBe('needs-you')
		expect(intentState(actors, 'i-fresh', log('i-fresh'))).toBe('working')
		expect(intentState(actors, 'i-weber', log('i-weber'))).toBe('done')
		expect(intentState(actors, 'i-month', log('i-month'))).toBe('working')
		expect(intentState(actors, 'i-note', log('i-note'))).toBe('needs-you')
		// Coordinator states inside a thread:
		expect(actorState(actors, 'inbox', log('i-mueller'))).toBe('done')
		expect(actorState(actors, 'accounting', log('i-mueller'))).toBe('needs-you')
		expect(actorState(actors, 'accounting', log('i-fresh'))).toBe('waiting')
		expect(actorState(actors, 'inbox', log('i-fresh'))).toBe('working')
	})

	test('the path is the chain of open asks — depth as a call stack', () => {
		expect(path(actors, 'inbox', log('i-fresh'))).toEqual(['extract', 'ocr'])
		// Müller: the accounting stack runs through book down to the human —
		// the open ask to YOU is the tip of the stack.
		expect(path(actors, 'accounting', log('i-mueller'))).toEqual(['book', 'you'])
	})

	test('member positions derive: done / current / pending', () => {
		const l = log('i-fresh')
		expect(memberState('ocr', l)).toBe('current')
		expect(memberState('parse-csv', l)).toBe('pending')
		expect(memberState('ocr', log('i-mueller'))).toBe('done')
	})

	test('a month waits on intents the same way anything waits: open asks', () => {
		const b = board(actors, 'i-month', log('i-month'))
		expect(b.map((x) => x.actor.id)).toEqual(['i-mueller', 'i-fresh', 'i-statement', 'i-weber'])
		expect(b.filter((x) => x.done).map((x) => x.actor.id)).toEqual(['i-weber'])
	})

	test('the human is just an actor: needs-you = an open ask addressed to you', () => {
		const open = openAsks(log('i-mueller'))
		expect(open.some((m) => m.to === YOU)).toBe(true)
		// And the answer will be a message like any other — nothing special stored.
	})

	test('engaged coordinators derive from the thread, not from a run table', () => {
		expect(engaged(actors, 'i-mueller', log('i-mueller'))).toEqual(['inbox', 'accounting'])
		expect(engaged(actors, 'i-statement', log('i-statement'))).toEqual([
			'inbox',
			'accounting',
			'human-desk'
		])
	})

	test('face state is the merged facts of the replies', () => {
		const fs = faceState(actors, 'accounting', log('i-mueller'))
		expect(Array.isArray(fs.lines)).toBe(true)
		expect(fs.pair).toContain('MUELLER')
		const inboxFs = faceState(actors, 'inbox', log('i-mueller'))
		expect(inboxFs.read).toContain('RE-2026-081')
	})

	test('an unrouted event is a message without `to` — routing is addressing', () => {
		for (const e of loose) {
			expect(e.to).toBeUndefined()
			if (e.suggest) expect(find(actors, e.suggest.intent)).toBeDefined()
		}
	})

	test('threads only speak to known addresses', () => {
		const known = new Set([...actors.map((a) => a.id), YOU])
		const sources = new Set(['upload', 'bank', 'voice', 'period'])
		for (const t of threads) {
			for (const m of t.log) {
				expect(known.has(m.from) || sources.has(m.from)).toBe(true)
				if (m.to) expect(known.has(m.to) || sources.has(m.to)).toBe(true)
			}
		}
	})

	test('the canvas lays out derivation: every member placed, every wire inferred', () => {
		const coordinators = registry.filter((a) => (a.members?.length ?? 0) > 0)
		const roots = coordinators.filter((c) => !coordinators.some((o) => o.members?.includes(c.id)))
		for (const c of coordinators) {
			const laid = layoutCoordinator(registry, c.id, roots)
			const ids = new Set(laid.nodes.map((n) => n.id))
			// Every member gets a position, every wire stays on the canvas …
			for (const m of c.members ?? []) expect(ids.has(m)).toBe(true)
			for (const e of laid.edges) {
				expect(ids.has(e.source)).toBe(true)
				expect(ids.has(e.target)).toBe(true)
			}
			// … and beyond the members only inferred doors exist.
			for (const n of laid.nodes) {
				if (!c.members?.includes(n.id)) expect(n.id.startsWith('door:')).toBe(true)
			}
		}
	})

	test('the old handoffs reappear as inferences: skill boundaries are doors', () => {
		const coordinators = registry.filter((a) => (a.members?.length ?? 0) > 0)
		const roots = coordinators.filter((c) => !coordinators.some((o) => o.members?.includes(c.id)))
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
