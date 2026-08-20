import { describe, expect, test } from 'bun:test'
import { Actor } from '../src/lib/actors/actor'
import { summarizeRecord } from '../src/lib/actors/summarize'
import { SPARKS, todoConfig } from '../src/lib/actors/todo.config'

/**
 * Manifest-as-data (0143): the todo actor is DATA + a generic actor, not a
 * subclass. `todoConfig` carries the whole surface, and a bare `new Actor()`
 * over it is the running todo actor. The record→activity summary is generic
 * too (keyed on the record shape, no domain code).
 */

describe('todo as a pure-data config', () => {
	test('the config carries the full tool surface, views and injected machine', () => {
		expect(todoConfig.id).toBe('todo')
		const tools = todoConfig.methods.map((m) => m.name)
		for (const t of [
			'todo_list',
			'todo_create',
			'todo_update',
			'todo_delete',
			'todo_show',
			'todo_clear_done'
		]) {
			expect(tools).toContain(t)
		}
		expect(todoConfig.views?.map((v) => v.key)).toContain('board')
		// The machine (todo-machine.pl) is injected into the sandbox program.
		expect(String(todoConfig.logic)).toContain('STATES')
		expect(String(todoConfig.logic)).toContain('STATUS_MOVES')
		expect(SPARKS.map((s) => s.id)).toEqual(['me', 'team'])
	})
})

describe('a GENERIC actor builds the whole todo actor from config alone', () => {
	test('every declared tool is bound on a bare Actor(todoConfig)', () => {
		const actor = new Actor(todoConfig)
		for (const t of [
			'todo_list',
			'todo_create',
			'todo_update',
			'todo_delete',
			'todo_show',
			'todo_clear_done'
		]) {
			expect(actor.handles(t)).toBe(true)
		}
		expect(actor.manifest.name).toBe('Todos')
		// Actor-level contracts come from the machine's `.pl` (produces(todo(T)).)
		expect(actor.produces).toContain('todo(T)')
	})
})

describe('summarizeRecord — generic record → activity, no domain code', () => {
	test('maps create / update-status / delete / list / show by record shape', () => {
		expect(
			summarizeRecord('x', JSON.stringify({ ok: true, created: [{ title: 'Milk' }] }))
		).toEqual({
			kind: 'created',
			titles: ['Milk']
		})
		expect(
			summarizeRecord(
				'x',
				JSON.stringify({ ok: true, updated: [{ title: 'Milk', status: 'done' }] })
			)
		).toEqual({ kind: 'done', titles: ['Milk'] })
		expect(
			summarizeRecord('x', JSON.stringify({ ok: true, deleted: [{ title: 'Milk' }] }))
		).toEqual({
			kind: 'deleted',
			titles: ['Milk']
		})
		expect(summarizeRecord('x', JSON.stringify({ ok: false, error: 'nope' }))).toEqual({
			kind: 'failed',
			titles: [],
			note: 'nope'
		})
	})
})
