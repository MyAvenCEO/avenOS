import { invoke } from '@tauri-apps/api/core'

// Read-only Fly.io client (board 0055). All calls run device-side via the native `fly_fetch`
// command (the webview can't reach Fly — CSP + CORS), with the user's decrypted token as a
// Bearer header. Orgs come from the GraphQL API; apps + machines from the Machines REST API.
// Read-only by construction: a GraphQL *query* (no mutation) + GETs only.

type FlyResponse = { status: number; body: string }

async function flyFetch(
	method: string,
	url: string,
	token: string,
	body?: string
): Promise<FlyResponse> {
	return invoke<FlyResponse>('fly_fetch', { method, url, token, body })
}

export type Org = { id: string; slug: string; name: string }
export type App = { name: string; status?: string }
export type Machine = { id: string; name?: string; state?: string; region?: string }

export async function listOrgs(token: string): Promise<Org[]> {
	const res = await flyFetch(
		'POST',
		'https://api.fly.io/graphql',
		token,
		JSON.stringify({ query: '{ organizations { nodes { id slug name } } }' })
	)
	if (res.status !== 200) throw new Error(`Fly orgs HTTP ${res.status}`)
	const data = JSON.parse(res.body) as {
		data?: { organizations?: { nodes?: Org[] } }
		errors?: { message: string }[]
	}
	if (data.errors?.length) throw new Error(data.errors.map((e) => e.message).join('; '))
	return data.data?.organizations?.nodes ?? []
}

export async function listApps(token: string, orgSlug: string): Promise<App[]> {
	const res = await flyFetch(
		'GET',
		`https://api.machines.dev/v1/apps?org_slug=${encodeURIComponent(orgSlug)}`,
		token
	)
	if (res.status !== 200) throw new Error(`Fly apps HTTP ${res.status}`)
	const data = JSON.parse(res.body) as { apps?: App[] }
	return data.apps ?? []
}

export async function listMachines(token: string, appName: string): Promise<Machine[]> {
	const res = await flyFetch(
		'GET',
		`https://api.machines.dev/v1/apps/${encodeURIComponent(appName)}/machines`,
		token
	)
	if (res.status !== 200) throw new Error(`Fly machines HTTP ${res.status}`)
	return JSON.parse(res.body) as Machine[]
}
