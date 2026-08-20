import { describe, expect, test } from 'bun:test'
import { loadMachine } from '../src/lib/actors/machine'
import { todoConfig } from '../src/lib/actors/todo.config'
import windowMachineSource from '../src/lib/actors/window-machine.pl?raw'

/**
 * Machine-per-actor (0147): the `.pl` is a manifest field, and MORE than one
 * actor carries one — loaded uniformly by the same `loadMachine`. Todo and the
 * view-window each declare their own statechart as data.
 */

describe('the machine is a manifest field, declared by any actor', () => {
	test('todo declares its machine on the manifest', () => {
		expect(typeof todoConfig.machine).toBe('string')
		const m = loadMachine(todoConfig.machine ?? '')
		expect(m.states.sort()).toEqual(['doing', 'done', 'open'])
	})

	test('the view-window declares its own — shown ⇄ hidden, loaded the same way', () => {
		const m = loadMachine(windowMachineSource)
		expect(m.states.sort()).toEqual(['hidden', 'shown'])
		expect(m.initial).toEqual(['hidden'])
		expect(m.transitions).toContainEqual({ event: 'show', from: 'hidden', to: 'shown' })
		expect(m.transitions).toContainEqual({ event: 'hide', from: 'shown', to: 'hidden' })
	})

	test('one loader serves both — the statechart is the universal primitive', () => {
		const todo = loadMachine(todoConfig.machine ?? '')
		const win = loadMachine(windowMachineSource)
		// Same shape from the same engine, two very different actors.
		expect(todo.transitions.length).toBeGreaterThan(win.transitions.length)
		for (const m of [todo, win]) {
			expect(m.initial.length).toBe(1)
			expect(m.states.length).toBeGreaterThanOrEqual(2)
		}
	})
})
