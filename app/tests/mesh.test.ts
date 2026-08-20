import { describe, expect, test } from 'bun:test'
import { loadMachine } from '../src/lib/actors/machine'
import machineSource from '../src/lib/actors/todo-machine.pl?raw'
import { layoutMachine } from '../src/lib/mesh/machine-layout'

/**
 * The machine and its diagram. `todo-machine.pl` is the source of truth; the
 * fact-only engine (machine.ts) answers goals by unification, and the canvas
 * draws it state-as-node (0145). The old declared-mesh mock (registry/model/
 * coordinator layout) was deleted in 0146 — the Actors viewer renders every
 * actor's machine from its manifest, fed by the live bus.
 */

describe('machine: the fact-only Prolog reader over todo-machine.pl', () => {
	const m = loadMachine(machineSource)

	test('the three kanban states and their bookends parse', () => {
		expect(m.states.sort()).toEqual(['doing', 'done', 'open'])
		expect(m.initial).toEqual(['open'])
		expect(m.terminal).toEqual(['done'])
	})

	test('transitions unify out as (event, from, to) triples', () => {
		expect(m.transitions).toContainEqual({ event: 'create', from: 'none', to: 'open' })
		expect(m.transitions).toContainEqual({ event: 'start', from: 'open', to: 'doing' })
		expect(m.transitions).toContainEqual({ event: 'finish', from: 'doing', to: 'done' })
		expect(m.transitions).toContainEqual({ event: 'complete', from: 'open', to: 'done' })
		// delete fires from all three real states.
		expect(
			m.transitions
				.filter((t) => t.event === 'delete')
				.map((t) => t.from)
				.sort()
		).toEqual(['doing', 'done', 'open'])
	})

	test('legal()/legalStatus() are the live-app gate: only declared moves pass', () => {
		expect(m.legal('finish', 'doing', 'done')).toBe(true)
		expect(m.legalStatus('open', 'doing')).toBe(true)
		expect(m.legalStatus('open', 'done')).toBe(true) // the checkbox (complete)
		expect(m.legalStatus('done', 'doing')).toBe(false) // no slipping back
	})

	test('nextStates()/nextStatus() answer what a task may do next', () => {
		expect(m.nextStates('open')).toContainEqual({ event: 'start', to: 'doing' })
		expect(m.nextStatus('open')).toBe('doing')
		expect(m.nextStatus('doing')).toBe('done')
		expect(
			m
				.nextStates('done')
				.map((n) => n.event)
				.sort()
		).toEqual(['clear_done', 'delete', 'reopen'])
	})

	test('guards and views come through', () => {
		expect(m.guards).toContainEqual({ event: 'clear_done', cond: 'status(done)' })
		expect(m.views.sort()).toEqual(['board', 'list'])
		expect(
			m.shows
				.filter((s) => s.view === 'board')
				.map((s) => s.state)
				.sort()
		).toEqual(['doing', 'done', 'open'])
	})
})

describe('layoutMachine — states as nodes, transitions as arrows (0145)', () => {
	const m = loadMachine(machineSource)
	const laid = layoutMachine(m)

	test('one node per real state, plus the entry/exit voids', () => {
		const stateNodes = laid.nodes.filter((n) => n.kind === 'state').map((n) => n.label)
		expect(stateNodes.sort()).toEqual(['doing', 'done', 'open'])
		// create comes from the void, delete/clear go to it.
		expect(laid.nodes.some((n) => n.kind === 'entry')).toBe(true)
		expect(laid.nodes.some((n) => n.kind === 'exit')).toBe(true)
		// the initial/terminal are marked, for the ring.
		expect(laid.nodes.find((n) => n.label === 'open')?.initial).toBe(true)
		expect(laid.nodes.find((n) => n.label === 'done')?.terminal).toBe(true)
	})

	test('one edge per transition, the event as its label', () => {
		expect(laid.edges.length).toBe(m.transitions.length)
		expect(laid.edges).toContainEqual(
			expect.objectContaining({ source: 'state:open', target: 'state:doing', label: 'start' })
		)
		expect(laid.edges).toContainEqual(
			expect.objectContaining({ source: 'state:doing', target: 'state:done', label: 'finish' })
		)
		expect(laid.edges).toContainEqual(
			expect.objectContaining({ source: 'state:open', target: 'state:done', label: 'complete' })
		)
		expect(laid.edges).toContainEqual(
			expect.objectContaining({ source: 'state:done', target: 'state:open', label: 'reopen' })
		)
		expect(laid.edges).toContainEqual(
			expect.objectContaining({ source: 'entry', target: 'state:open', label: 'create' })
		)
		// every deletion lands on the exit void.
		expect(laid.edges.filter((e) => e.target === 'exit').length).toBeGreaterThanOrEqual(4)
	})

	test('states sit in cycle order along one row', () => {
		const row = laid.nodes.filter((n) => n.kind === 'state')
		expect(row.every((n) => n.position.y === 0)).toBe(true)
		const byX = [...row].sort((a, b) => a.position.x - b.position.x).map((n) => n.label)
		expect(byX).toEqual(['open', 'doing', 'done'])
	})
})
