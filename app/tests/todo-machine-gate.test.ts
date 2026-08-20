import { describe, expect, test } from 'bun:test'
import { loadMachine } from '../src/lib/actors/machine'
import { createSession } from '../src/lib/actors/sandbox'
import todoMachineSource from '../src/lib/actors/todo-machine.pl?raw'
import { composeTodoProgram } from '../src/lib/actors/views/todo/logic'

/**
 * The gate (card 0142): the live todo reducer runs its transitions against
 * todo-machine.pl — the SAME `.pl` that draws the Skills canvas — injected
 * into the QuickJS sandbox as data. An illegal move is refused; a legal one
 * applies. The machine is the single source; nothing is hardcoded.
 */

const machine = loadMachine(todoMachineSource)
const program = composeTodoProgram(machine)

/** Start a session holding one task in a given status. */
async function withTask(status: string) {
	const session = await createSession(program)
	const state = await session.initState({
		items: [{ title: 'Task', status, spark: 'me' }],
		active: 'me'
	})
	return { session, state }
}

describe('todo machine gate — the reducer obeys the .pl', () => {
	test('done -> doing is illegal and REJECTED (state untouched)', async () => {
		// The machine has no done->doing: a finished task reopens to open, it
		// does not slip back into progress. So this UPDATE must change nothing.
		expect(machine.legalStatus('done', 'doing')).toBe(false)
		const { session, state } = await withTask('done')
		try {
			const out = await session.reduce(state, {
				send: 'UPDATE',
				payload: { ids: ['w1'], status: 'in_progress' }
			})
			const rec = out.record as { ok: boolean; rejected: string[] }
			expect((out.state.items as { status: string }[])[0].status).toBe('done')
			expect(rec.ok).toBe(false)
			expect(rec.rejected.length).toBe(1)
		} finally {
			session.dispose()
		}
	})

	test('open -> doing is legal and APPLIES', async () => {
		expect(machine.legalStatus('open', 'doing')).toBe(true)
		const { session, state } = await withTask('open')
		try {
			const out = await session.reduce(state, {
				send: 'UPDATE',
				payload: { ids: ['w1'], status: 'in_progress' }
			})
			expect((out.state.items as { status: string }[])[0].status).toBe('doing')
			expect((out.record as { ok: boolean }).ok).toBe(true)
		} finally {
			session.dispose()
		}
	})

	test('open -> done stays legal — the list checkbox shortcut (complete)', async () => {
		expect(machine.legalStatus('open', 'done')).toBe(true)
		const { session, state } = await withTask('open')
		try {
			const out = await session.reduce(state, { send: 'TOGGLE', payload: { id: 'w1' } })
			expect((out.state.items as { status: string }[])[0].status).toBe('done')
		} finally {
			session.dispose()
		}
	})

	test('CYCLE follows the .pl cycle order, not a hardcoded chain', async () => {
		const { session, state } = await withTask('open')
		try {
			const one = await session.reduce(state, { send: 'CYCLE', payload: { id: 'w1' } })
			expect((one.state.items as { status: string }[])[0].status).toBe(machine.nextStatus('open'))
			const two = await session.reduce(one.state, { send: 'CYCLE', payload: { id: 'w1' } })
			expect((two.state.items as { status: string }[])[0].status).toBe('done') // open->doing->done
		} finally {
			session.dispose()
		}
	})
})
