const scopeId = process.env.ARTIFACT_STORE_SCOPE_ID ?? '11111111-1111-4111-8111-111111111111'
const databaseName = process.env.ARTIFACT_STORE_DATABASE_NAME ?? 'cust_artifact_local'
const token = process.env.INTENT_SERVICE_BEARER_TOKEN ?? 'intent-local-api-token-000000000001'
const baseUrl = (
	process.env.INTENT_SERVICE_BASE_URL ??
	`http://127.0.0.1:${process.env.INTENT_SERVICE_PORT ?? '8091'}`
).replace(/\/$/, '')
const root = `${baseUrl}/v1/scopes/${scopeId}/intents`

async function request(
	path: string,
	method = 'GET',
	body?: unknown,
	options: { bearer?: string; url?: string } = {}
): Promise<Response> {
	return fetch(`${options.url ?? root}${path}`, {
		method,
		headers: {
			...(options.bearer === '' ? {} : { authorization: `Bearer ${options.bearer ?? token}` }),
			'x-aven-artifact-database': databaseName,
			...(body === undefined ? {} : { 'content-type': 'application/json' })
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	})
}

async function json(path: string, method = 'GET', body?: unknown) {
	const response = await request(path, method, body)
	if (!response.ok)
		throw new Error(`${method} ${path}: HTTP ${response.status} ${await response.text()}`)
	return (await response.json()) as Record<string, unknown>
}

const targetId = crypto.randomUUID()
const sourceId = crypto.randomUUID()
if ((await request('', 'GET', undefined, { bearer: '' })).status !== 401)
	throw new Error('Intent API accepted an unauthenticated request')
if (
	(await request('', 'GET', undefined, { bearer: 'wrong-intent-token-000000000000' })).status !==
	401
)
	throw new Error('Intent API accepted the wrong bearer credential')
const wrongScopeRoot = `${baseUrl}/v1/scopes/99999999-9999-4999-8999-999999999999/intents`
if ((await request('', 'GET', undefined, { url: wrongScopeRoot })).status !== 404)
	throw new Error('Intent API accepted the wrong scope')

let target = await json('', 'POST', {
	id: targetId,
	title: 'Lifecycle smoke target',
	intentType: 'test',
	sourceLabel: 'Smoke test',
	deadline: null,
	routingSummary: 'Disposable lifecycle target'
})
const initialVersion = target.version
const replayedTarget = await json('', 'POST', {
	id: targetId,
	title: 'Lifecycle smoke target',
	intentType: 'test',
	sourceLabel: 'Smoke test',
	deadline: null,
	routingSummary: 'Disposable lifecycle target'
})
if (replayedTarget.version !== initialVersion)
	throw new Error('Idempotent intent creation changed the version')
if (
	(
		await request('', 'POST', {
			id: targetId,
			title: 'Conflicting reuse of an intent ID',
			intentType: 'test',
			sourceLabel: 'Smoke test',
			deadline: null,
			routingSummary: 'Must be rejected'
		})
	).status !== 400
)
	throw new Error('Intent creation accepted conflicting content for an existing ID')

let source = await json('', 'POST', {
	id: sourceId,
	title: 'Lifecycle smoke source',
	intentType: 'test',
	sourceLabel: 'Smoke test',
	deadline: null,
	routingSummary: 'Disposable lifecycle source'
})

const contributionId = crypto.randomUUID()
const contribution = {
	id: contributionId,
	contributorKind: 'human',
	kind: 'message',
	text: 'Idempotent lifecycle smoke message',
	payload: { source: 'smoke' }
}
await json(`/${targetId}/contributions`, 'POST', contribution)
const afterContribution = await json(`/${targetId}`)
await json(`/${targetId}/contributions`, 'POST', contribution)
const afterContributionReplay = await json(`/${targetId}`)
if (afterContributionReplay.version !== afterContribution.version)
	throw new Error('Idempotent contribution replay changed the intent version')
if (
	(
		await request(`/${targetId}/contributions`, 'POST', {
			...contribution,
			text: 'Conflicting reuse of a contribution ID'
		})
	).status !== 400
)
	throw new Error('Contribution replay accepted conflicting content')

target = afterContributionReplay

target = await json(`/${targetId}`, 'PATCH', {
	expectedVersion: target.version,
	title: 'Lifecycle smoke target updated',
	clearDeadline: false
})
const stale = await request(`/${targetId}`, 'PATCH', {
	expectedVersion: 1,
	title: 'Must not win',
	clearDeadline: false
})
if (stale.status !== 409)
	throw new Error(`Expected stale update conflict, got HTTP ${stale.status}`)

source = await json(`/${sourceId}/archive`, 'POST', {
	id: sourceId,
	expectedVersion: source.version
})
if (source.state !== 'archive') throw new Error('Archive did not become durable')
source = await json(`/${sourceId}/restore`, 'POST', {
	id: sourceId,
	expectedVersion: source.version
})
if (source.state === 'archive') throw new Error('Restore did not become durable')

target = await json(`/${targetId}/merge`, 'POST', {
	id: targetId,
	expectedVersion: target.version,
	sourceIntentIds: [sourceId]
})
const listed = (await json('')) as unknown as Array<Record<string, unknown>>
if (listed.some((intent) => intent.id === sourceId))
	throw new Error('Merged source remained active')

const deleted = await request(`/${targetId}`, 'DELETE', {
	id: targetId,
	expectedVersion: target.version
})
if (!deleted.ok) throw new Error(`Delete failed with HTTP ${deleted.status}`)
if ((await request(`/${targetId}`)).status !== 404)
	throw new Error('Deleted intent remained readable')

console.log(JSON.stringify({ status: 'ok', targetId, sourceId }, null, 2))
