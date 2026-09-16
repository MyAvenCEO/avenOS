import type { CapabilitySlot } from './actor'
import type { RuntimeArtifact, RuntimeInputBinding, RuntimeOutputDraft } from './executor'
import { resourceId } from './ids'
import { assertPortableRunValue } from './run'

export const PORT_RESULT_SCHEMA = resourceId({ authority: 'os.aven', kind: 'schema',
	namespace: 'actors', name: 'port-result', version: '1' })
export const EXECUTION_RECEIPT_SCHEMA = resourceId({ authority: 'os.aven', kind: 'schema',
	namespace: 'actors', name: 'execution-receipt', version: '1' })
export const PORT_RESULT_ARTIFACT_TYPE = { key: 'actors.port-result', version: 1 } as const
export const EXECUTION_RECEIPT_ARTIFACT_TYPE = { key: 'actors.execution-receipt', version: 1 } as const

export type NamedPortMember =
	| { memberKey: string; kind: 'new'; draft: RuntimeOutputDraft }
	| { memberKey: string; kind: 'reuse'; artifact: RuntimeArtifact }

export interface NamedPortResult {
	port: string
	cardinality: CapabilitySlot['cardinality']
	members: NamedPortMember[]
}

export interface CheckedPortResults {
	/** Canonical declared-port order, never actor object-return order. */
	ports: NamedPortResult[]
	/** Distinct new domain occurrences in port/member order. */
	newMembers: Array<{ port: string; memberKey: string; draft: RuntimeOutputDraft }>
	/** Explicitly admitted existing occurrences, not semantic cache guesses. */
	reusedMembers: Array<{ port: string; memberKey: string; artifact: RuntimeArtifact }>
}

export interface PortResultRecord {
	localKey: string
	payload: { invocationId: string; port: string;
		cardinality: CapabilitySlot['cardinality'];
		members: Array<{ memberKey: string; referenceOrdinal: number }> }
	references: Array<{ role: 'member'; localKey?: string; artifactId?: string }>
}

export interface StoredPortResultReference {
	role: string
	ordinal: number
	artifactId?: string | null
}

export interface StoredPortResultPayload {
	invocationId: string
	port: string
	cardinality: CapabilitySlot['cardinality']
	members: Array<{ memberKey: string; referenceOrdinal: number }>
}

export class PortResultError extends Error {
	constructor(readonly code: string, message: string) {
		super(message)
		this.name = 'PortResultError'
	}
}

const memberKeyPattern = /^[a-z][a-z0-9_-]{0,63}$/

/**
 * Check a v2 result before any Store publication. Reuse is limited to committed
 * occurrences the host already admitted for this invocation. Neither a label nor
 * equal bytes can substitute a member reference.
 */
export function checkNamedPortResults(
	declared: readonly CapabilitySlot[],
	returned: readonly NamedPortResult[],
	admittedReuseIds: ReadonlySet<string> = new Set()
): CheckedPortResults {
	const slots = new Map<string, CapabilitySlot>()
	for (const slot of declared) {
		if (slots.has(slot.name)) throw new PortResultError('DUPLICATE_DECLARED_PORT', 'Output port is declared twice.')
		if (!slot.schema || !slot.role || slot.sensitive)
			throw new PortResultError('INCOMPLETE_PORT_CONTRACT', 'Output port needs a public schema and role.')
		slots.set(slot.name, slot)
	}
	const seen = new Map<string, NamedPortResult>()
	for (const result of returned) {
		const slot = slots.get(result.port)
		if (!slot) throw new PortResultError('UNDECLARED_PORT', 'Actor returned an undeclared output port.')
		if (seen.has(result.port)) throw new PortResultError('DUPLICATE_PORT', 'Actor returned one port twice.')
		if (result.cardinality !== slot.cardinality || !Array.isArray(result.members))
			throw new PortResultError('CARDINALITY_MISMATCH', 'Actor result cardinality differs from its contract.')
		if ((slot.cardinality === 'one' && result.members.length !== 1) ||
			(slot.cardinality === 'optional' && result.members.length > 1) ||
			(slot.cardinality === 'many' && result.members.length > 256))
			throw new PortResultError('CARDINALITY_MISMATCH', 'Actor returned an invalid number of members.')
		const keys = new Set<string>()
		for (const member of result.members) {
			if (!memberKeyPattern.test(member.memberKey) || keys.has(member.memberKey))
				throw new PortResultError('DUPLICATE_MEMBER_KEY', 'Member keys must be unique stable names.')
			keys.add(member.memberKey)
			if (member.kind === 'new') {
				if (member.draft.slot !== slot.name || member.draft.role !== slot.role ||
					member.draft.schema !== slot.schema || member.draft.predicate !== slot.predicate)
					throw new PortResultError('OUTPUT_CONTRACT_MISMATCH', 'New member differs from its declared port.')
				assertPortableRunValue(member.draft.value)
			} else if (member.kind === 'reuse') {
				if (!admittedReuseIds.has(member.artifact.artifactId))
					throw new PortResultError('UNADMITTED_REUSE', 'Reused occurrence was not admitted for this invocation.')
				if (member.artifact.schema !== slot.schema || member.artifact.predicate !== slot.predicate)
					throw new PortResultError('OUTPUT_CONTRACT_MISMATCH', 'Reused member differs from its declared port.')
			} else throw new PortResultError('UNKNOWN_MEMBER_KIND', 'Unknown result member kind.')
		}
		seen.set(result.port, result)
	}
	if (seen.size !== slots.size)
		throw new PortResultError('MISSING_PORT_RESULT', 'Every declared output port needs a result, including empty ports.')
	const ports = [...slots.keys()].map((port) => seen.get(port)!)
	const newMembers: CheckedPortResults['newMembers'] = []
	const reusedMembers: CheckedPortResults['reusedMembers'] = []
	for (const result of ports)
		for (const member of result.members)
			if (member.kind === 'new') newMembers.push({ port: result.port, memberKey: member.memberKey, draft: member.draft })
			else reusedMembers.push({ port: result.port, memberKey: member.memberKey, artifact: member.artifact })
	return { ports, newMembers, reusedMembers }
}

/**
 * Construct structural membership in the same order as the Actor's checked port
 * members. The host publishes these records and the domain outputs atomically;
 * a result artifact is still required for an empty optional/many port.
 */
export function buildPortResultRecords(
	invocationId: string,
	checked: CheckedPortResults
): { domainOutputs: Array<{ localKey: string; draft: RuntimeOutputDraft }>;
	portResults: PortResultRecord[] } {
	if (!invocationId || invocationId.length > 160)
		throw new PortResultError('INVALID_INVOCATION', 'Result needs an exact invocation identity.')
	const domainOutputs: Array<{ localKey: string; draft: RuntimeOutputDraft }> = []
	const portResults: PortResultRecord[] = []
	for (const [portIndex, port] of checked.ports.entries()) {
		const references: PortResultRecord['references'] = []
		for (const member of port.members) {
			if (member.kind === 'new') {
				const localKey = `domain-${domainOutputs.length}`
				domainOutputs.push({ localKey, draft: member.draft })
				references.push({ role: 'member', localKey })
			} else references.push({ role: 'member', artifactId: member.artifact.artifactId })
		}
		portResults.push({
			localKey: `result-${portIndex}`,
			payload: { invocationId, port: port.port, cardinality: port.cardinality,
				members: port.members.map((member, referenceOrdinal) => ({
					memberKey: member.memberKey, referenceOrdinal
				})) },
			references
		})
	}
	return { domainOutputs, portResults }
}

/** A zero-domain-output Actor still gets an inspectable completion boundary. */
export function buildExecutionReceiptRecord(
	invocationId: string,
	capabilityId: string,
	implementationRef: string,
	outcome: 'completed' | 'uncertain' | 'failed',
	inputs: readonly RuntimeInputBinding[]
): { payload: { invocationId: string; capabilityId: string;
	implementationRef: string; outcome: string };
	references: Array<{ role: 'input'; artifactId: string;
		attributes: { slot: string; role: string } }> } {
	if (!invocationId || invocationId.length > 160 || !capabilityId || capabilityId.length > 256 ||
		!implementationRef || implementationRef.length > 256 || inputs.length > 16)
		throw new PortResultError('INVALID_RECEIPT', 'Completion receipt has an invalid exact identity.')
	return {
		payload: { invocationId, capabilityId, implementationRef, outcome },
		references: inputs.map((input) => ({ role: 'input', artifactId: input.artifact.artifactId,
			attributes: { slot: input.slot, role: input.role } }))
	}
}

/** A committed report is usable only if its payload and structural references agree. */
export function readPortResultMembership(
	expectedInvocationId: string,
	payload: StoredPortResultPayload,
	references: readonly StoredPortResultReference[],
	declared: CapabilitySlot
): Array<{ memberKey: string; artifactId: string }> {
	if (!expectedInvocationId || payload.invocationId !== expectedInvocationId ||
		payload.port !== declared.name || payload.cardinality !== declared.cardinality ||
		!Array.isArray(payload.members) || payload.members.length > 256)
		throw new PortResultError('PORT_RESULT_CONTRACT_MISMATCH', 'Committed result differs from its declared port.')
	if ((declared.cardinality === 'one' && payload.members.length !== 1) ||
		(declared.cardinality === 'optional' && payload.members.length > 1))
		throw new PortResultError('PORT_RESULT_CARDINALITY', 'Committed result has an invalid member count.')
	const members = references.filter((reference) => reference.role === 'member')
	if (members.length !== payload.members.length ||
		references.length !== members.length)
		throw new PortResultError('PORT_RESULT_REFERENCE_MISMATCH', 'Result membership and references disagree.')
	const byOrdinal = new Map<number, StoredPortResultReference>()
	for (const reference of members) {
		if (!Number.isInteger(reference.ordinal) || reference.ordinal < 0 ||
			reference.ordinal >= members.length || byOrdinal.has(reference.ordinal))
			throw new PortResultError('PORT_RESULT_REFERENCE_MISMATCH', 'Result reference ordinals are invalid.')
		byOrdinal.set(reference.ordinal, reference)
	}
	const keys = new Set<string>()
	return payload.members.map((entry, index) => {
		const reference = byOrdinal.get(index)
		if (!reference || entry.referenceOrdinal !== index ||
			!memberKeyPattern.test(entry.memberKey) || keys.has(entry.memberKey))
			throw new PortResultError('PORT_RESULT_REFERENCE_MISMATCH', 'Result reference order is invalid.')
		keys.add(entry.memberKey)
		if (!reference.artifactId)
			throw new PortResultError('PORT_RESULT_MEMBER_UNAVAILABLE', 'A result member is unavailable under current authority.')
		return { memberKey: entry.memberKey, artifactId: reference.artifactId }
	})
}
