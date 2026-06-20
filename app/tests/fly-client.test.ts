import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Record every native fly_fetch the client issues, and reply with minimal valid bodies. Mocking
// the Tauri invoke lets us assert the client is READ-ONLY without touching Fly. board 0055.
const calls: { method: string; url: string; body?: string }[] = []

mock.module('@tauri-apps/api/core', () => ({
	invoke: async (
		_cmd: string,
		args: { method: string; url: string; token: string; body?: string }
	) => {
		calls.push({ method: args.method, url: args.url, body: args.body })
		if (args.url.includes('/graphql')) {
			return {
				status: 200,
				body: JSON.stringify({
					data: { organizations: { nodes: [{ id: '1', slug: 'acme', name: 'Acme' }] } }
				})
			}
		}
		if (args.url.includes('/v1/apps?')) {
			return { status: 200, body: JSON.stringify({ apps: [{ name: 'web' }] }) }
		}
		return {
			status: 200,
			body: JSON.stringify([{ id: 'm1', name: 'm', state: 'started', region: 'fra' }])
		}
	}
}))

const { listApps, listMachines, listOrgs } = await import('../src/lib/fly/client')

describe('fly client (board 0055) — read-only', () => {
	beforeEach(() => {
		calls.length = 0
	})

	test('issues exactly the 3 read-only request shapes and zero writes', async () => {
		expect((await listOrgs('tok'))[0].slug).toBe('acme')
		expect((await listApps('tok', 'acme'))[0].name).toBe('web')
		expect((await listMachines('tok', 'web'))[0].state).toBe('started')

		expect(calls).toEqual([
			{
				method: 'POST',
				url: 'https://api.fly.io/graphql',
				body: JSON.stringify({ query: '{ organizations { nodes { id slug name } } }' })
			},
			{ method: 'GET', url: 'https://api.machines.dev/v1/apps?org_slug=acme', body: undefined },
			{ method: 'GET', url: 'https://api.machines.dev/v1/apps/web/machines', body: undefined }
		])

		// zero writes: GETs, plus one GraphQL *query* POST (no `mutation`).
		const writes = calls.filter(
			(c) =>
				c.method !== 'GET' && !(c.url.endsWith('/graphql') && !(c.body ?? '').includes('mutation'))
		)
		expect(writes).toHaveLength(0)
	})
})
