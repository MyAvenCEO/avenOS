import { describe, expect, test } from 'bun:test'
import { buildExecutionReceiptRecord, buildPortResultRecords, checkNamedPortResults,
	readPortResultMembership, PortResultError, resourceId,
	type CapabilitySlot, type NamedPortResult, type RuntimeArtifact } from '../src'

const schema = resourceId({ authority: 'ceo.aven', kind: 'schema', namespace: 'fixture',
	name: 'report', version: '1' })
const one: CapabilitySlot = { name: 'summary', predicate: 'fixture.summary(X)',
	schema, role: 'summary', cardinality: 'one' }
const optional: CapabilitySlot = { name: 'details', predicate: 'fixture.details(X)',
	schema, role: 'details', cardinality: 'optional' }
const many: CapabilitySlot = { name: 'members', predicate: 'fixture.member(X)',
	schema, role: 'member', cardinality: 'many' }
const member = (slot: CapabilitySlot, memberKey: string, value: unknown) => ({
	memberKey, kind: 'new' as const, draft: { slot: slot.name, role: slot.role!,
		predicate: slot.predicate, schema: slot.schema!, value }
})
const result = (slot: CapabilitySlot, members: NamedPortResult['members']): NamedPortResult => ({
	port: slot.name, cardinality: slot.cardinality, members
})

describe('named Actor port results', () => {
	test('normalizes shuffled return order and records empty optional and many ports', () => {
		const checked = checkNamedPortResults([one, optional, many], [
			result(many, []), result(optional, []), result(one, [member(one, 'first', { text: 'same' })])
		])
		expect(checked.ports.map((port) => port.port)).toEqual(['summary', 'details', 'members'])
		expect(checked.ports.map((port) => port.members.length)).toEqual([1, 0, 0])
		expect(checked.newMembers.map((entry) => entry.memberKey)).toEqual(['first'])
		const built = buildPortResultRecords('invocation-exact', checked)
		expect(built.domainOutputs.map((output) => output.localKey)).toEqual(['domain-0'])
		expect(built.portResults.map((record) => record.payload.members)).toEqual([
			[{ memberKey: 'first', referenceOrdinal: 0 }], [], []
		])
		expect(built.portResults[0]?.references).toEqual([{ role: 'member', localKey: 'domain-0' }])
	})

	test('equal bytes do not collapse separate ordered occurrences', () => {
		const checked = checkNamedPortResults([many], [result(many, [
			member(many, 'left', 'same bytes'), member(many, 'right', 'same bytes')
		])])
		expect(checked.newMembers.map((entry) => entry.memberKey)).toEqual(['left', 'right'])
		expect(checked.newMembers).toHaveLength(2)
		expect(buildPortResultRecords('invocation-exact', checked).portResults[0]?.references)
			.toEqual([{ role: 'member', localKey: 'domain-0' },
				{ role: 'member', localKey: 'domain-1' }])
	})

	test('rejects undeclared, omitted, duplicate and forged member contracts', () => {
		expect(() => checkNamedPortResults([one], [])).toThrow('Every declared output port')
		expect(() => checkNamedPortResults([one], [result(one, [])])).toThrow('invalid number')
		expect(() => checkNamedPortResults([many], [result(many, [
			member(many, 'same', 1), member(many, 'same', 2)
		])])).toThrow('unique stable names')
		expect(() => checkNamedPortResults([one], [result(one, [
			{ ...member(one, 'first', 1), draft: { ...member(one, 'first', 1).draft,
				predicate: 'fixture.private(X)' } }
		])])).toThrow('differs from its declared port')
		expect(() => checkNamedPortResults([], [result(one, [])])).toThrow(PortResultError)
	})

	test('reuses only exact previously admitted committed occurrences', () => {
		const existing: RuntimeArtifact = { artifactId: 'exact-id', predicate: one.predicate,
			schema, typeKey: 'fixture.summary', schemaVersion: 1,
			contentDigest: 'digest', value: { text: 'same' } }
		const port = result(one, [{ memberKey: 'cached', kind: 'reuse', artifact: existing }])
		expect(() => checkNamedPortResults([one], [port])).toThrow('not admitted')
		expect(checkNamedPortResults([one], [port], new Set(['exact-id'])).reusedMembers)
			.toMatchObject([{ memberKey: 'cached', artifact: { artifactId: 'exact-id' } }])
		expect(buildPortResultRecords('invocation-exact',
		checkNamedPortResults([one], [port], new Set(['exact-id']))).portResults[0]?.references)
		.toEqual([{ role: 'member', artifactId: 'exact-id' }])
	})

	test('zero-output completion has no invented domain result', () => {
		expect(checkNamedPortResults([], [])).toEqual({ ports: [], newMembers: [], reusedMembers: [] })
		const input: RuntimeArtifact = { artifactId: 'source-exact', predicate: one.predicate,
			schema, typeKey: 'fixture.summary', schemaVersion: 1,
			contentDigest: 'digest', value: { text: 'source' } }
		expect(buildExecutionReceiptRecord('invocation-exact',
			'os.aven:capability:fixture:notify@1', 'registered-instance', 'completed',
			[{ slot: 'source', role: 'input', artifact: input }])).toMatchObject({
			payload: { invocationId: 'invocation-exact', outcome: 'completed' },
			references: [{ artifactId: 'source-exact', attributes: { slot: 'source', role: 'input' } }]
		})
	})

	test('read-side binding ignores row order but rejects lost, duplicate and redacted references', () => {
		const payload = { invocationId: 'exact-call', port: 'members', cardinality: 'many' as const,
			members: [{ memberKey: 'left', referenceOrdinal: 0 },
				{ memberKey: 'right', referenceOrdinal: 1 }] }
		const refs = [{ role: 'member', ordinal: 0, artifactId: 'origin-left' },
			{ role: 'member', ordinal: 1, artifactId: 'origin-right' }]
		expect(readPortResultMembership('exact-call', payload, refs, many)).toEqual([
			{ memberKey: 'left', artifactId: 'origin-left' },
			{ memberKey: 'right', artifactId: 'origin-right' }
		])
		expect(() => readPortResultMembership('exact-call', payload, refs.slice(0, 1), many))
			.toThrow('membership and references disagree')
		expect(readPortResultMembership('exact-call', payload, [refs[1], refs[0]], many))
			.toEqual([{ memberKey: 'left', artifactId: 'origin-left' },
				{ memberKey: 'right', artifactId: 'origin-right' }])
		expect(() => readPortResultMembership('exact-call', payload,
			[refs[0], { ...refs[1], ordinal: 0 }], many))
			.toThrow('ordinals are invalid')
		expect(() => readPortResultMembership('exact-call', payload,
			[refs[0], { ...refs[1], artifactId: null }], many))
			.toThrow('unavailable under current authority')
		expect(readPortResultMembership('exact-call', { ...payload, members: [] }, [], many)).toEqual([])
		expect(() => readPortResultMembership('different-call', payload, refs, many))
			.toThrow('differs from its declared port')
	})
})
