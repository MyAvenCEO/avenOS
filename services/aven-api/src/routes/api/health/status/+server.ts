import { json } from '@sveltejs/kit'
import {
	CURRENT_ARTIFACT_PROCESSOR_SCHEMA_VERSION,
	CURRENT_ARTIFACT_STORE_SCHEMA_VERSION,
	CURRENT_INTENT_SERVICE_SCHEMA_VERSION
} from '$lib/server/environments/provisioning.js'
import { workerFreshness } from '$lib/server/ops.js'
import { runtime } from '$lib/server/runtime.js'

interface EnvironmentHealth {
	missing: number
	pending: number
	failed: number
	expired_leases: number
	drifted: number
}

export const GET = async () => {
	const { database, config } = await runtime()
	const heartbeats = await workerFreshness(database.pool)
	const fresh = (worker: string, staleSeconds: number) => {
		const seen = heartbeats.get(worker)
		return Boolean(seen && Date.now() - seen.getTime() <= staleSeconds * 1000)
	}
	const emailAlive = fresh('email-worker', config.EMAIL_WORKER_STALE_SECONDS)
	const environmentAlive = fresh('environment-worker', config.ENVIRONMENT_WORKER_STALE_SECONDS)
	const artifactConfigured = Boolean(
		config.ARTIFACT_STORE_BASE_URL && config.ARTIFACT_STORE_BEARER_TOKEN
	)
	const processorConfigured = Boolean(
		config.ARTIFACT_PROCESSOR_BASE_URL && config.ARTIFACT_PROCESSOR_BEARER_TOKEN
	)
	const intentConfigured = Boolean(
		config.INTENT_SERVICE_BASE_URL && config.INTENT_SERVICE_BEARER_TOKEN
	)
	let environmentState: EnvironmentHealth | null = null
	let sampleDatabase: string | null = null
	try {
		environmentState =
			(
				await database.pool.query<EnvironmentHealth>(
					`SELECT
				   (SELECT COUNT(*)::int FROM names name_record
				    LEFT JOIN customer_environments environment ON environment.name=name_record.name
				    WHERE name_record.status='owned' AND environment.id IS NULL) AS missing,
				   (SELECT COUNT(*)::int FROM customer_environment_jobs
				    WHERE status IN ('queued','running')) AS pending,
				   (SELECT COUNT(*)::int FROM customer_environments WHERE status='failed') AS failed,
				   (SELECT COUNT(*)::int FROM customer_environment_jobs
				    WHERE status='running' AND lease_expires_at < now()) AS expired_leases,
				   (SELECT COUNT(*)::int
				    FROM customer_environments environment
				    JOIN names name_record ON name_record.name=environment.name
				    WHERE environment.status<>'failed'
				      AND NOT EXISTS (
				        SELECT 1 FROM customer_environment_jobs job
				        WHERE job.environment_id=environment.id AND job.status IN ('queued','running')
				      )
				      AND (
				        (name_record.status='owned' AND (
				          environment.status<>'ready' OR ($1::boolean AND (
				            environment.artifact_store_status<>'ready' OR environment.artifact_store_schema_version<$2
				          )) OR ($3::boolean AND (
				            environment.artifact_processor_status<>'ready' OR
			            environment.artifact_processor_schema_version<$4
			          )) OR ($5::boolean AND (
			            environment.intent_service_status<>'ready' OR
			            environment.intent_service_schema_version<$6
			          ))
				        )) OR
				        (name_record.status<>'owned' AND (
				          environment.status<>'suspended' OR
				          environment.artifact_store_status<>'suspended' OR
			          ($3::boolean AND environment.artifact_processor_status<>'suspended')
			          OR ($5::boolean AND environment.intent_service_status<>'suspended')
				        ))
				      )) AS drifted`,
					[
						artifactConfigured,
						CURRENT_ARTIFACT_STORE_SCHEMA_VERSION,
						processorConfigured,
						CURRENT_ARTIFACT_PROCESSOR_SCHEMA_VERSION,
						intentConfigured,
						CURRENT_INTENT_SERVICE_SCHEMA_VERSION
					]
				)
			).rows[0] ?? null
		if (artifactConfigured) {
			sampleDatabase =
				(
					await database.pool.query<{ database_name: string }>(
						`SELECT environment.database_name
						 FROM customer_environments environment
						 JOIN names name_record ON name_record.name=environment.name
						 WHERE name_record.status='owned' AND environment.status='ready'
						   AND environment.artifact_store_status='ready'
						   AND environment.artifact_store_schema_version >= $1
						 ORDER BY environment.id LIMIT 1`,
						[CURRENT_ARTIFACT_STORE_SCHEMA_VERSION]
					)
				).rows[0]?.database_name ?? null
		}
	} catch {
		/* response carries only safe aggregate state */
	}
	let artifactReachable = !artifactConfigured
	if (artifactConfigured) {
		try {
			const response = await fetch(
				new URL(sampleDatabase ? '/v1/context' : '/health/ready', config.ARTIFACT_STORE_BASE_URL),
				{
					headers: sampleDatabase
						? {
								authorization: `Bearer ${config.ARTIFACT_STORE_BEARER_TOKEN}`,
								'x-aven-artifact-database': sampleDatabase
							}
						: undefined,
					signal: AbortSignal.timeout(2_000)
				}
			)
			artifactReachable = response.ok
			await response.body?.cancel()
		} catch {
			artifactReachable = false
		}
	}
	let processorReachable = !processorConfigured
	if (processorConfigured) {
		try {
			const response = await fetch(new URL('/health/ready', config.ARTIFACT_PROCESSOR_BASE_URL), {
				signal: AbortSignal.timeout(2_000)
			})
			processorReachable = response.ok
			await response.body?.cancel()
		} catch {
			processorReachable = false
		}
	}
	let intentReachable = !intentConfigured
	if (intentConfigured) {
		try {
			const response = await fetch(new URL('/health/ready', config.INTENT_SERVICE_BASE_URL), {
				signal: AbortSignal.timeout(2_000)
			})
			intentReachable = response.ok
			await response.body?.cancel()
		} catch {
			intentReachable = false
		}
	}
	const environmentKnown = Boolean(environmentState)
	const environmentControlled = Boolean(
		environmentState &&
			environmentState.missing === 0 &&
			environmentState.failed === 0 &&
			environmentState.expired_leases === 0 &&
			environmentState.drifted === 0
	)
	const healthy =
		emailAlive &&
		environmentAlive &&
		environmentKnown &&
		environmentControlled &&
		artifactReachable &&
		processorReachable &&
		intentReachable
	return json({
		overall: healthy ? 'healthy' : 'degraded',
		capabilities: {
			authentication: true,
			emailQueueing: true,
			emailDelivery: emailAlive ? 'available' : 'delayed',
			environmentProvisioning: environmentAlive ? 'available' : 'delayed',
			artifactStorage: !artifactConfigured
				? 'disabled'
				: artifactReachable
					? 'available'
					: 'unavailable',
			artifactProcessing: !processorConfigured
				? 'disabled'
				: processorReachable
					? 'available'
					: 'unavailable',
			intents: !intentConfigured ? 'disabled' : intentReachable ? 'available' : 'unavailable'
		},
		environments: environmentState ?? {
			missing: null,
			pending: null,
			failed: null,
			expired_leases: null,
			drifted: null
		}
	})
}
