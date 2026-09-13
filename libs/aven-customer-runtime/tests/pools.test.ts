import { customerComponentCatalog, type TenantGrantClaims } from '@avenos/aven-customer-contracts'
import { afterEach, expect, test, vi } from 'vitest'

const { created } = vi.hoisted(() => ({ created: [] as Array<{ end: ReturnType<typeof vi.fn> }> }))
vi.mock('pg', () => ({
	default: {
		Pool: class {
			end = vi.fn(async () => {})
			constructor() {
				created.push(this)
			}
			on() {}
			async query() {
				const component = customerComponentCatalog.find(
					(c) => c.componentRef === 'os.aven:component:actors:run-repository@1'
				)!
				return {
					rows: [
						{
							schema_version: component.minimumRuntimeSchemaVersion,
							migration_set_digest: component.migrationSetDigest,
							routing_generation: 1
						}
					]
				}
			}
		}
	}
}))

import { TenantPoolProvider } from '../src/pools'

const grant = (id: string) =>
	({
		componentRef: 'os.aven:component:actors:run-repository@1',
		environmentId: id,
		databaseName: 'test',
		routingGeneration: 1
	}) as TenantGrantClaims
const config = {
	host: 'localhost',
	port: 5432,
	ssl: false,
	credentialRoot: 'x'.repeat(64),
	roleKind: 'os.aven:db-role:actors:worker@1',
	roleSuffix: 'act_worker',
	componentRef: 'os.aven:component:actors:run-repository@1',
	searchPath: ['aven_actor_runs'],
	maxPools: 1,
	idleMilliseconds: 1
}
afterEach(() => {
	created.length = 0
	vi.restoreAllMocks()
})
test('idle and capacity eviction preserve a busy execution pool', async () => {
	let busy = true,
		now = 1
	vi.spyOn(Date, 'now').mockImplementation(() => now)
	const provider = new TenantPoolProvider({ ...config, canEvict: () => !busy })
	const pool = await provider.forGrant(grant('11111111-1111-4111-8111-111111111111'))
	now = 10000
	expect(await provider.forGrant(grant('11111111-1111-4111-8111-111111111111'))).toBe(pool)
	await expect(provider.forGrant(grant('22222222-2222-4222-8222-222222222222'))).rejects.toThrow(
		'busy'
	)
	expect(created[0]?.end).not.toHaveBeenCalled()
	busy = false
	await provider.forGrant(grant('22222222-2222-4222-8222-222222222222'))
	expect(created[0]?.end).toHaveBeenCalledOnce()
	await provider.close()
})
test('oldest eviction waits for its owner to drain before ending the pool', async () => {
	let release!: () => void
	const drain = new Promise<void>((resolve) => {
		release = resolve
	})
	const evict = vi.fn(() => drain)
	const provider = new TenantPoolProvider({ ...config, idleMilliseconds: 1e9, onEvict: evict })
	await provider.forGrant(grant('11111111-1111-4111-8111-111111111111'))
	const pending = provider.forGrant(grant('22222222-2222-4222-8222-222222222222'))
	await vi.waitFor(() => expect(evict).toHaveBeenCalledOnce())
	expect(created[0]?.end).not.toHaveBeenCalled()
	release()
	await pending
	expect(created[0]?.end).toHaveBeenCalledOnce()
	await provider.close()
})
