import { json } from '@sveltejs/kit'
import { workerFreshness } from '$lib/server/ops.js'
import { runtime } from '$lib/server/runtime.js'

export const GET = async () => {
	const { database, config } = await runtime()
	const heartbeats = await workerFreshness(database.pool)
	const fresh = (worker: string, staleSeconds: number) => {
		const seen = heartbeats.get(worker)
		return Boolean(seen && Date.now() - seen.getTime() <= staleSeconds * 1000)
	}
	const emailAlive = fresh('email-worker', config.EMAIL_WORKER_STALE_SECONDS)
	const environmentAlive = fresh('environment-worker', config.ENVIRONMENT_WORKER_STALE_SECONDS)
	return json({
		overall: emailAlive && environmentAlive ? 'healthy' : 'degraded',
		capabilities: {
			authentication: true,
			emailQueueing: true,
			emailDelivery: emailAlive ? 'available' : 'delayed',
			environmentProvisioning: environmentAlive ? 'available' : 'delayed'
		}
	})
}
