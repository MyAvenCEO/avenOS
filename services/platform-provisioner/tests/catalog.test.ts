import { describe, expect, test } from 'vitest'
import { catalogDigest, loadCatalog } from '../src/catalog.js'

describe('static customer component catalog', () => {
	test('pins migrations and least-privilege function roles', async () => {
		const catalog = await loadCatalog()
		for (const { manifest } of catalog.values()) {
			expect(manifest.targetSchemaVersion).toBeGreaterThanOrEqual(
				manifest.minimumRuntimeSchemaVersion
			)
			expect(manifest.targetSchemaVersion).toBeLessThanOrEqual(manifest.maximumRuntimeSchemaVersion)
		}
		expect(catalogDigest(catalog)).toMatch(/^[0-9a-f]{64}$/)
		expect([...catalog.keys()].sort()).toEqual([
			'ceo.aven:component:data:artifacts@1',
			'ceo.aven:component:data:credentials@1',
			'ceo.aven:component:data:intents@1',
			'ceo.aven:component:data:productivity@1',
			'os.aven:component:actors:run-repository@1'
		])
		const credentials = catalog.get('ceo.aven:component:data:credentials@1')!
		expect(credentials.manifest.requiredByDefault).toBe(false)
		expect(credentials.manifest.functionRoles).toHaveLength(5)
		for (const grant of Object.values(credentials.grants)) {
			expect(grant.tables).toEqual([])
			expect(grant.functions?.length).toBeGreaterThan(0)
		}
		const actors = catalog.get('os.aven:component:actors:run-repository@1')
		expect(actors?.manifest.targetSchemaVersion).toBe(7)
		expect(actors?.migrations.at(-1)?.id).toBe('0007_reviews')
		expect(actors?.grants['os.aven:db-role:actors:api@1']?.tables).toEqual([
			{ name: 'runs', privileges: ['SELECT', 'INSERT', 'UPDATE'] },
			{ name: 'studio_drafts', privileges: ['SELECT', 'INSERT', 'UPDATE'] },
			{ name: 'studio_connections', privileges: ['SELECT', 'INSERT', 'UPDATE'] },
			{ name: 'studio_deliveries', privileges: ['SELECT', 'INSERT', 'UPDATE'] },
			{ name: 'run_settlement', privileges: ['SELECT'] }
		])
		expect(actors?.grants['os.aven:db-role:actors:worker@1']?.tables).toEqual([
			{ name: 'runs', privileges: ['SELECT', 'UPDATE'] },
			{ name: 'run_steps', privileges: ['SELECT', 'INSERT', 'UPDATE'] },
			{ name: 'run_settlement', privileges: ['SELECT'] },
			{ name: 'studio_drafts', privileges: ['SELECT', 'INSERT', 'UPDATE'] },
			{ name: 'studio_draft_receipts', privileges: ['SELECT', 'INSERT'] }
		])
		expect(
			catalog.get('ceo.aven:component:data:productivity@1')?.grants[
				'ceo.aven:db-role:productivity:api@1'
			]?.tables
		).toEqual([
			{ name: 'tasks', privileges: ['SELECT', 'INSERT', 'UPDATE'] },
			{ name: 'task_commands', privileges: ['SELECT', 'INSERT'] },
			{ name: 'task_revisions', privileges: ['SELECT', 'INSERT'] }
		])
	})
})
