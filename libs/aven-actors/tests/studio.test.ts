import { describe, expect, test } from 'bun:test'
import {
	compileStudio,
	draftFor,
	parseStudioDefinition,
	routesFor,
	type StudioDefinition,
	StudioValidationError
} from '../src/studio'

const file = { key: 'core.file', version: 1 }
const understanding = { key: 'studio.understanding', version: 1 }
const brief = { key: 'studio.brief', version: 1 }
const childId = '11111111-1111-4111-8111-111111111111'
function parent(): StudioDefinition {
	return {
		...draftFor(file, understanding, 'Parent'),
		steps: ['first', 'second'].map((id) => ({
			id,
			kind: 'skill',
			label: id,
			ref: childId,
			inputs: { source: { kind: 'input', name: 'source' } },
			parameters: {}
		})),
		output: { type: understanding, from: { kind: 'step', name: 'second' } }
	}
}
function code(fn: () => unknown, expected: string) {
	try {
		fn()
		throw new Error('Expected rejection')
	} catch (e) {
		expect(e).toBeInstanceOf(StudioValidationError)
		expect((e as StudioValidationError).issues[0]?.code).toBe(expected)
	}
}
describe('Studio compiler', () => {
	test('fills a goal using the existing solver and marks observations conditional', () => {
		const program = compileStudio(draftFor(file, brief))
		expect(program.invocations).toBe(2)
		expect(program.steps[0]?.capabilities?.map((c) => c.id)).toEqual([
			'document.understand@1',
			'report.brief@1'
		])
		expect(program.conditional).toBe(true)
		expect(program.definition.policy.allowModel).toBe(false)
	})
	test('does not invent routes for an arbitrary artifact type or incompatible version', () => {
		expect(routesFor({ key: 'uninstalled.document', version: 1 }, brief)).toEqual([])
		expect(routesFor({ key: 'core.file', version: 2 }, brief)).toEqual([])
		code(() => compileStudio(draftFor(brief, file)), 'NO_ROUTE')
	})
	test('fixed steps, multiple inputs and explicit output bindings remain intact', () => {
		const d = draftFor(understanding, brief)
		d.inputs.companion = file
		d.steps[0] = {
			id: 'brief',
			kind: 'capability',
			label: 'Brief',
			ref: 'report.brief@1',
			inputs: { source: { kind: 'input', name: 'source' } },
			parameters: { title: 'Board note' }
		}
		d.output.from.name = 'brief'
		expect(compileStudio(d).steps[0]?.parameters).toEqual({ title: 'Board note' })
		expect(compileStudio(d).definition.inputs.companion).toEqual(file)
	})
	test('same child used twice consumes one shared budget without flattening call identities', () => {
		const d = parent()
		const library = new Map([[childId, draftFor(file, understanding)]])
		const compiled = compileStudio(d, library)
		expect(compiled.invocations).toBe(2)
		expect(compiled.steps.map((s) => s.id)).toEqual(['first', 'second'])
		expect(compiled.children).toEqual([childId])
		d.policy.maxInvocations = 1
		code(() => compileStudio(d, library), 'BUDGET_LIMIT')
	})
	test('parent model policy constrains child calls and never changes the saved child', () => {
		const child = draftFor(file, understanding)
		child.policy.allowModel = true
		const compiled = compileStudio(parent(), new Map([[childId, child]]))
		expect(compiled.steps[0]?.child?.definition.policy.allowModel).toBe(false)
		expect(child.policy.allowModel).toBe(true)
	})
	test('rejects recursion and excessive nesting before execution', () => {
		code(() => compileStudio(parent(), new Map([[childId, parent()]])), 'CYCLE')
		const d = parent()
		d.policy.maxDepth = 1
		code(() => compileStudio(d, new Map([[childId, draftFor(file, understanding)]])), 'DEPTH_LIMIT')
	})
	test('missing or wrong child signatures are not approximate matches', () => {
		code(() => compileStudio(parent()), 'MISSING_CHILD')
		code(
			() => compileStudio(parent(), new Map([[childId, draftFor(understanding, brief)]])),
			'TYPE_MISMATCH'
		)
	})
	test('a leaf child can be reused even when its own nesting allowance is one', () => {
		const child = draftFor(file, understanding)
		child.policy.maxDepth = 1
		expect(compileStudio(parent(), new Map([[childId, child]])).invocations).toBe(2)
	})
	test('rejects forward links, output mismatches, duplicate IDs and unknown executable fields', () => {
		const d = draftFor(file, brief)
		d.steps[0]!.inputs.source = { kind: 'step', name: 'missing' }
		code(() => compileStudio(d), 'MISSING_INPUT')
		const output = draftFor(file, brief)
		output.output.type = file
		code(() => compileStudio(output), 'TYPE_MISMATCH')
		const duplicate = parent()
		duplicate.steps[1]!.id = 'first'
		code(() => parseStudioDefinition(duplicate), 'INVALID_PROGRAM')
		code(
			() => parseStudioDefinition({ ...draftFor(file, brief), executable: 'arbitrary code' }),
			'INVALID_PROGRAM'
		)
	})
	test('inspectable Review nodes are honestly blocked until continuation support is implemented', () => {
		const d = draftFor(file, file)
		d.steps = [
			{
				id: 'review',
				kind: 'review',
				label: 'Review',
				inputs: { source: { kind: 'input', name: 'source' } },
				parameters: {}
			}
		]
		d.output.from.name = 'review'
		expect(parseStudioDefinition(d).steps[0]?.kind).toBe('review')
		code(() => compileStudio(d), 'UNSUPPORTED_REVIEW')
	})
	test('rejects prototype names, oversized or secret-shaped parameters and extra policy fields', () => {
		const d = draftFor(file, brief)
		d.inputs.constructor = file
		code(() => parseStudioDefinition(d), 'INVALID_PROGRAM')
		const p = draftFor(file, brief)
		p.steps[0]!.parameters.token = 'x'.repeat(513)
		code(() => parseStudioDefinition(p), 'INVALID_PROGRAM')
		code(
			() => parseStudioDefinition({ ...p, policy: { ...p.policy, credentials: 'secret' } }),
			'INVALID_PROGRAM'
		)
	})
	test('hypothetical policy comparison is pure and keeps the baseline untouched', () => {
		const baseline = draftFor(file, brief)
		const saved = JSON.stringify(baseline)
		expect(compileStudio(baseline).invocations).toBe(2)
		code(
			() => compileStudio({ ...baseline, policy: { ...baseline.policy, maxInvocations: 1 } }),
			'BUDGET_LIMIT'
		)
		expect(JSON.stringify(baseline)).toBe(saved)
	})
})
