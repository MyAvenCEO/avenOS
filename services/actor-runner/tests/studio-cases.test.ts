import { expect, test, vi } from 'vitest'
import type { StudioArtifact, StudioArtifacts } from '../src/studio-artifacts'
import { StudioCases } from '../src/studio-cases'
import { StudioService } from '../src/studio-service'

const example = () => ({
	title: 'Brief',
	situation: 'Received an email',
	outcome: 'A short brief',
	evidence: [
		{
			id: 'e',
			kind: 'recollection',
			sourceId: 'user',
			locator: '',
			quote: 'I summarized that email by hand.',
			interpretation: ''
		}
	],
	steps: [
		{
			id: 'gap',
			kind: 'ideal',
			label: 'Summarize',
			evidenceIds: ['e'],
			needs: 'Email',
			produces: 'Brief',
			acceptance: 'Includes the deadline'
		}
	],
	uncertainties: []
})
function fixture() {
	const scope = crypto.randomUUID(),
		subject = crypto.randomUUID()
	const saved = new Map<string, StudioArtifact>(),
		publications = new Map<string, StudioArtifact[]>()
	const store = {
		scope,
		get: vi.fn(async (id: string) => {
			const a = saved.get(id)
			if (!a) throw Error('RESOURCE_UNAVAILABLE')
			return a
		}),
		lookup: async (id: string) => publications.get(id) ?? null,
		publish: vi.fn(async (p: Parameters<StudioArtifacts['publish']>[0]) => {
			const artifacts = p.artifacts.map(
				(a) =>
					({
						artifactId: crypto.randomUUID(),
						scopeId: scope,
						typeKey: a.type,
						typeVersion: 1,
						payload: structuredClone(a.payload),
						publicationId: p.id,
						committedAt: new Date().toISOString()
					}) as StudioArtifact
			)
			for (const a of artifacts) saved.set(a.artifactId, a)
			publications.set(p.id, artifacts)
			return artifacts
		})
	} as unknown as StudioArtifacts
	return {
		store,
		saved,
		subject,
		cases: new StudioCases(store),
		security: {
			principal: { kind: 'user', subjectId: subject, assurance: [] },
			access: { tenantId: scope }
		} as any
	}
}
test('confirmation and corrections preserve an immutable predecessor chain and reset confirmation', async () => {
	const f = fixture(),
		original = await f.cases.propose(example(), f.subject)
	expect(await f.cases.propose(example(), f.subject)).toEqual(original)
	const confirmed = await f.cases.confirm(original.artifactId, f.subject)
	expect(confirmed.payload).toMatchObject({
		status: 'confirmed',
		predecessorArtifactId: original.artifactId
	})
	const revision = await f.cases.propose(
		{ ...example(), outcome: 'Include attachments too' },
		f.subject,
		confirmed.artifactId
	)
	expect(revision.payload).toMatchObject({
		status: 'proposed',
		predecessorArtifactId: confirmed.artifactId
	})
	expect(original.payload.status).toBe('proposed')
	expect(f.saved.size).toBe(3)
})
test('cross-scope artifact evidence fails before any case is written', async () => {
	const f = fixture(),
		c = example()
	c.evidence[0] = { ...c.evidence[0], kind: 'artifact', sourceId: crypto.randomUUID() }
	await expect(f.cases.propose(c, f.subject)).rejects.toThrow('RESOURCE_UNAVAILABLE')
	expect(f.store.publish).not.toHaveBeenCalled()
})
test('a revision cannot change the source or quotation behind an existing evidence ID', async () => {
	const f = fixture(),
		original = await f.cases.propose(example(), f.subject)
	for (const change of [
		{ quote: 'I summarized that email by hand. Later I checked an attachment.' },
		{ sourceId: 'a-different-contribution' },
		{ kind: 'message' }
	]) {
		const value = example()
		Object.assign(value.evidence[0], change)
		await expect(f.cases.propose(value, f.subject, original.artifactId)).rejects.toThrow(
			'new evidence ID'
		)
	}
	expect(f.store.publish).toHaveBeenCalledTimes(1)
	expect((await f.cases.read(original.artifactId)).record.case).toEqual(example())
	const value = example()
	value.evidence[0].locator = 'First user contribution'
	value.evidence[0].interpretation = 'A manual procedure to refine.'
	value.evidence.push({
		...value.evidence[0],
		id: 'attachment',
		quote: 'I also checked an attachment.'
	})
	const successor = await f.cases.propose(value, f.subject, original.artifactId)
	expect(successor.payload).toMatchObject({
		case: value,
		predecessorArtifactId: original.artifactId
	})
	expect(f.store.publish).toHaveBeenCalledTimes(2)
})
test('proposal recovery reads only an exact committed outcome and never writes', async () => {
	const f = fixture()
	expect(await f.cases.recoverProposal(example(), f.subject)).toBeNull()
	expect(f.store.publish).not.toHaveBeenCalled()
	const original = await f.cases.propose(example(), f.subject)
	const revised = { ...example(), outcome: 'A brief with an explicit decision' }
	const revision = await f.cases.propose(revised, f.subject, original.artifactId)
	const writes = vi.mocked(f.store.publish).mock.calls.length
	expect(await f.cases.recoverProposal(example(), f.subject)).toEqual(original)
	expect(await f.cases.recoverProposal(revised, f.subject, original.artifactId)).toEqual(revision)
	expect(await f.cases.recoverProposal(revised, f.subject)).toBeNull()
	expect(
		await f.cases.recoverProposal(revised, crypto.randomUUID(), original.artifactId)
	).toBeNull()
	expect(
		await f.cases.recoverProposal(
			{ ...revised, outcome: 'Different' },
			f.subject,
			original.artifactId
		)
	).toBeNull()
	expect(vi.mocked(f.store.publish).mock.calls.length).toBe(writes)
})
test('case recovery rejects wrong scope, type, payload or receipt identity', async () => {
	for (const change of [
		{ scopeId: crypto.randomUUID() },
		{ typeKey: 'studio.skill' },
		{ typeVersion: 2 },
		{ publicationId: crypto.randomUUID() },
		{ payload: {} }
	]) {
		const f = fixture()
		const original = await f.cases.propose(example(), f.subject)
		Object.assign(original, change)
		await expect(f.cases.recoverProposal(example(), f.subject)).rejects.toThrow('does not match')
		expect(f.store.publish).toHaveBeenCalledTimes(1)
	}
})
test('service rejects unconfirmed and ideal procedures and read-only mutations; what-if does not write', async () => {
	const f = fixture(),
		service = new StudioService({} as any, f.store, {} as any)
	const original = await f.cases.propose(example(), f.subject)
	const call = (operation: string, artifactId: string, readOnly = false) =>
		service.call({ operation, data: { artifactId } }, f.security, {} as any, readOnly)
	await expect(call('case-build', original.artifactId)).rejects.toThrow('Confirm this case')
	await expect(call('case-confirm', original.artifactId, true)).rejects.toThrow('write access')
	const confirmed = await f.cases.confirm(original.artifactId, f.subject)
	await expect(call('case-build', confirmed.artifactId)).rejects.toThrow(
		'Resolve the missing steps'
	)
	const writes = vi.mocked(f.store.publish).mock.calls.length
	expect(await call('case-what-if', confirmed.artifactId, true)).toMatchObject({
		executes: false,
		gaps: 1
	})
	expect(vi.mocked(f.store.publish).mock.calls.length).toBe(writes)
})
