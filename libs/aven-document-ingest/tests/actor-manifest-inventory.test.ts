import { describe, expect, test } from 'vitest'
import { TrustedActorInstallations } from '@avenos/actors'
import { createDocumentActors, DOCUMENT_ACTOR_MANIFESTS } from '../src/actors/registry'

describe('document Actor release inventory', () => {
	test('exports every method without running a decoder or model during inventory', async () => {
		let externalCalls = 0
		const actors = createDocumentActors(
			{ decode: async () => { externalCalls++; throw new Error('decoder must not run') } },
			{ status: async () => { externalCalls++; throw new Error('model must not run') },
				complete: async () => { externalCalls++; throw new Error('model must not run') } }
		)
		try {
			expect(DOCUMENT_ACTOR_MANIFESTS).toHaveLength(18)
			expect(actors.all).toHaveLength(18)
			expect(externalCalls).toBe(0)
			const constructed = new Map(actors.all.map((actor) => [actor.manifest.id, actor.manifest]))
			expect(new Set(DOCUMENT_ACTOR_MANIFESTS.map((manifest) => manifest.id)).size).toBe(18)
			for (const manifest of DOCUMENT_ACTOR_MANIFESTS)
				expect(constructed.get(manifest.id)).toEqual(manifest)

			const installations = new TrustedActorInstallations()
			for (const manifest of DOCUMENT_ACTOR_MANIFESTS)
				await installations.install({
					packageId: 'ceo.aven:package:docs:ingest@1', manifest,
					placements: ['server'], schemas: [], procedures: []
				})
			const inventory = installations.inventory()
			expect(inventory).toHaveLength(18)
			expect(inventory.every((entry) => entry.disposition === 'contract-incomplete')).toBe(true)
			expect(inventory.every((entry) => entry.reasonCodes.includes('PROCEDURE_UNDECLARED')))
				.toBe(true)
			expect(inventory.every((entry) =>
				entry.reasonCodes.includes('PARAMETERS_SCHEMA_UNSUPPORTED'))).toBe(true)
			expect(externalCalls).toBe(0)
		} finally {
			for (const actor of actors.all) actor.dispose()
		}
	})
})
