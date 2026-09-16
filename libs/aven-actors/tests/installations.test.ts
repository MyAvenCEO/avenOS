import { describe, expect, test } from 'bun:test'
import { TrustedActorInstallations, definitionFromManifest, type ActorInstallationDescriptor } from '../src'

const digest = 'a'.repeat(64)
const manifest = {
	id: 'fixture', authority: 'ceo.aven', namespace: 'studio', version: '1',
	name: 'Fixture', description: 'Installed fixture', tags: ['test'], methods: [{
		name: 'produce', description: 'Produce a value',
		parameters: { type: 'object', properties: {}, additionalProperties: false },
		mode: 'transform' as const, idempotency: 'pure' as const,
		produces: ['fixture.value(X)'], outputSlots: [{
			name: 'value', predicate: 'fixture.value(X)',
			schema: 'ceo.aven:schema:studio:value@1', role: 'value', cardinality: 'one' as const
		}]
	}]
}
const capabilityId = definitionFromManifest(manifest).capabilities[0]!.id
const descriptor = (): ActorInstallationDescriptor => ({
	packageId: 'ceo.aven:package:studio:fixture@1', manifest: structuredClone(manifest),
	placements: ['server'],
	schemas: [{ schema: 'ceo.aven:schema:studio:value@1', typeKey: 'fixture.value',
		typeVersion: 1, projectorDigest: digest }],
	procedures: [{ capabilityId, procedureKey: 'fixture.produce', procedureVersion: '1',
		implementationDigest: digest, evidenceRuleDigest: digest, requiredFeatures: ['named-results@1'] }]
})

describe('trusted Actor installation descriptors', () => {
	test('retains a frozen, content-addressed contract and does not treat offers as contracts', async () => {
		const installs = new TrustedActorInstallations()
		const original = descriptor()
		const installed = await installs.install(original)
		const first = await installs.digest()
		original.manifest.name = 'Changed caller memory'
		expect(installed.descriptor.manifest.name).toBe('Fixture')
		expect(Object.isFrozen(installed)).toBe(true)
		expect(Object.isFrozen(installed.descriptor.manifest)).toBe(true)
		expect(Object.isFrozen(installed.definition.manifest)).toBe(true)
		expect(await installs.install(descriptor())).toBe(installed)
		expect(await installs.digest()).toBe(first)
		expect(installs.list().map((item) => item.definition.ref)).toEqual([installed.definition.ref])
	})

	test('requires a new version when projector, implementation, or owning package changes', async () => {
		const installs = new TrustedActorInstallations()
		await installs.install(descriptor())
		for (const change of [
			(d: ActorInstallationDescriptor) => { d.schemas[0]!.projectorDigest = 'b'.repeat(64) },
			(d: ActorInstallationDescriptor) => { d.procedures[0]!.implementationDigest = 'b'.repeat(64) },
			(d: ActorInstallationDescriptor) => { d.packageId = 'another-package' }
		]) {
			const changed = descriptor()
			change(changed)
			await expect(installs.install(changed)).rejects.toThrow('ACTOR_INSTALLATION_IDENTITY_CONFLICT')
		}
	})

	test('rejects foreign procedure IDs and invalid projector digests', async () => {
		const installs = new TrustedActorInstallations()
		const foreign = descriptor()
		foreign.procedures[0]!.capabilityId = 'ceo.aven:capability:studio:foreign@1'
		await expect(installs.install(foreign)).rejects.toThrow('ACTOR_INSTALLATION_PROCEDURE_INVALID')
		const badProjector = descriptor()
		badProjector.schemas[0]!.projectorDigest = 'not-a-digest'
		await expect(installs.install(badProjector)).rejects.toThrow('ACTOR_INSTALLATION_SCHEMA_INVALID')
		const badType = descriptor()
		badType.schemas[0]!.typeKey = 'Not A Store Type'
		await expect(installs.install(badType)).rejects.toThrow('ACTOR_INSTALLATION_SCHEMA_INVALID')
		const hiddenAddress = { ...descriptor(), importPath: '/untrusted/executor' }
		await expect(installs.install(hiddenAddress)).rejects.toThrow('ACTOR_INSTALLATION_INVALID')
	})

	test('accounts for proof, zero-output view, and incomplete methods without running them', async () => {
		const d = descriptor()
		d.manifest.methods.push({ name: 'show', description: 'Open a view',
			parameters: { type: 'object', properties: {}, additionalProperties: false },
			mode: 'view', idempotency: 'pure' })
		d.manifest.methods.push({ name: 'unknown', description: 'Needs contracts',
			parameters: { type: 'object' }, requires: ['fixture.value(X)'],
			produces: ['fixture.unknown(X)'] })
		const installs = new TrustedActorInstallations()
		await installs.install(d)
		const inventory = installs.inventory()
		expect(inventory).toHaveLength(3)
		expect(inventory.find((entry) => entry.method === 'produce')).toMatchObject({
			disposition: 'proof-producing', reasonCodes: []
		})
		expect(inventory.find((entry) => entry.method === 'show')).toMatchObject({
			disposition: 'non-proof', reasonCodes: []
		})
		expect(inventory.find((entry) => entry.method === 'unknown')).toMatchObject({
			disposition: 'contract-incomplete',
			reasonCodes: expect.arrayContaining(['MODE_UNDECLARED', 'INPUT_PORTS_UNDECLARED',
				'OUTPUT_PORTS_UNDECLARED'])
		})
	})
})
