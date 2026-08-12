import { describe, expect, test } from 'bun:test'
import { looksDegenerate } from '../src/lib/chat/redpill'

/**
 * The lane's degeneration guard: a model stuck in a repetition loop pads
 * until max_tokens — the guard must catch the loop early and must NOT fire
 * on real JSON, code, or prose.
 */
describe('looksDegenerate', () => {
	test('catches the live-observed repetition loops', () => {
		expect(
			looksDegenerate(
				`x`.repeat(100) +
					'stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop_stop'
			)
		).toBe(true)
		expect(looksDegenerate('a'.repeat(200) + '_z'.repeat(200))).toBe(true)
		expect(looksDegenerate('prose '.repeat(20) + 'TRUE_'.repeat(80))).toBe(true)
	})

	test('stays quiet on real machine output', () => {
		const proofs = JSON.stringify({
			proofs: [
				{ goal: 'streak(S)', seed: { done: ['mon', 'tue', 'wed'] }, expect: { streak: 3 } },
				{ goal: 'habit(H)', seed: { habit: 'joggen' }, expect: { habit: 'joggen' } }
			]
		})
		expect(looksDegenerate(proofs.repeat(3))).toBe(false)
		const logic =
			'function initState(source) { return { items: [] } }\n' +
			'function reduce(state, ev) {\n\tif (ev.send === "CREATE") { return state }\n\treturn state\n}\n'
		expect(looksDegenerate(logic.repeat(8))).toBe(false)
		expect(
			looksDegenerate(
				'Der Habit Tracker zeigt für jede Gewohnheit den aktuellen Streak an, ' +
					'also wie oft sie im richtigen Intervall erledigt wurde. Jede Gewohnheit ' +
					'hat einen Namen, ein Intervall und eine Dauer in Minuten. Beim Abhaken ' +
					'wird die Dauer erfasst und in der Historie gespeichert, damit die ' +
					'Kalenderansicht vergangene Erledigungen zeigen kann. '.repeat(3)
			)
		).toBe(false)
		// a sentence repeated VERBATIM a dozen times IS degeneration, and counts
		expect(
			looksDegenerate('Der Habit Tracker zeigt für jede Gewohnheit den Streak. '.repeat(12))
		).toBe(true)
	})

	test('short tails never trigger', () => {
		expect(looksDegenerate('stop_'.repeat(20))).toBe(false)
	})
})
