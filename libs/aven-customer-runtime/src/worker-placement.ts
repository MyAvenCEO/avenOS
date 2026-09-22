import {
	type TenantGrantKey,
	verifyWorkerPlacement,
	type WorkerPlacement,
	type WorkerPlacementRequest,
	workerPlacementRequestSchema
} from '@avenos/aven-customer-contracts'
import { readBoundedBytes } from '@avenos/http-boundary'
import { z } from 'zod'

const pageSchema = z
	.object({ placements: z.array(z.string().min(1).max(4096)).max(16), next: z.uuid().nullable() })
	.strict()

/** Operator-configured service transport. No model-provided URL, session cookie,
 * saved login or fabricated customer principal enters background discovery.
 */
export class WorkerPlacementClient {
	constructor(
		private readonly config: {
			baseUrl: string
			serviceToken: string
			runtimeId: string
			componentRef: WorkerPlacementRequest['componentRef']
			issuer: string
			publicKey: TenantGrantKey
		}
	) {
		const url = new URL(config.baseUrl)
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			config.serviceToken.length < 32
		)
			throw Error('Invalid worker directory configuration.')
	}

	async page(
		after?: string,
		signal?: AbortSignal
	): Promise<{ placements: WorkerPlacement[]; next: string | null }> {
		const page = await this.proofs(after, signal)
		return { placements: page.placements.map((entry) => entry.placement), next: page.next }
	}

	/** Keep the exact signed proof for a peer's narrow lifecycle endpoint. Neither
	 * the proof nor a decoded placement is a customer identity or tool permission.
	 */
	async proofs(
		after?: string,
		signal?: AbortSignal
	): Promise<{
		placements: Array<{ placement: WorkerPlacement; token: string }>
		next: string | null
	}> {
		return this.request({ after }, signal)
	}

	/** Refresh one host-selected workspace without scanning unrelated customers.
	 * No stale proof is cached: pause/movement/readiness and generation are checked
	 * again by the directory, then by the receiving physical component pool. */
	async proof(environmentId: string, generation: number, signal?: AbortSignal): Promise<string> {
		z.uuid().parse(environmentId)
		z.number().int().positive().parse(generation)
		const page = await this.request({ environmentId, limit: 1 }, signal)
		const entry = page.placements[0]
		if (!entry || entry.placement.routingGeneration !== generation)
			throw Error('The workspace placement is unavailable or changed.')
		return entry.token
	}

	private async request(
		selection: Pick<WorkerPlacementRequest, 'after' | 'environmentId'> & { limit?: number },
		signal?: AbortSignal
	) {
		const input = workerPlacementRequestSchema.parse({
			runtimeId: this.config.runtimeId,
			componentRef: this.config.componentRef,
			...selection
		})
		const response = await fetch(new URL('/internal/v1/work/placements', this.config.baseUrl), {
			method: 'POST',
			redirect: 'manual',
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(5000)])
				: AbortSignal.timeout(5000),
			headers: {
				authorization: `Bearer ${this.config.serviceToken}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify(input)
		})
		if (response.status !== 200) {
			await response.body?.cancel()
			throw Error('Worker directory is unavailable or access has ended.')
		}
		const page = pageSchema.parse(
			JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 80 * 1024, 5000)))
		)
		const placements = await Promise.all(
			page.placements.map((token) =>
				verifyWorkerPlacement(token, this.config.publicKey, this.config)
			)
		)
		// A bad page must not trap a worker in a scan or cause it to skip unseen tenants.
		if (
			placements.length > input.limit ||
			placements.some(
				(entry, i) => entry.environmentId <= (placements[i - 1]?.environmentId ?? input.after ?? '')
			) ||
			(input.environmentId &&
				(page.next !== null ||
					placements.length > 1 ||
					placements.some((entry) => entry.environmentId !== input.environmentId))) ||
			(page.next !== null &&
				(placements.length !== input.limit || page.next !== placements.at(-1)?.environmentId))
		)
			throw Error('Invalid worker directory pagination.')
		return {
			placements: placements.map((placement, i) => ({ placement, token: page.placements[i]! })),
			next: page.next
		}
	}
}
