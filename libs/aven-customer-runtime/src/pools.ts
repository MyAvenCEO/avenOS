import {
	customerComponentCatalog,
	databaseRoleName,
	deriveDatabasePassword,
	type TenantGrantClaims,
	type WorkerPlacement,
	workerPlacementSchema
} from '@avenos/aven-customer-contracts'
import pg from 'pg'

interface CachedPool {
	pool: pg.Pool
	lastUsed: number
}

export class TenantPoolProvider {
	private readonly pools = new Map<string, CachedPool>()

	constructor(
		private readonly config: {
			host: string
			port: number
			ssl: boolean
			credentialRoot: string
			roleKind: string
			roleSuffix: string
			componentRef: string
			searchPath: string[]
			maxPools?: number
			maxConnectionsPerPool?: number
			idleMilliseconds?: number
			onEvict?: (pool: pg.Pool) => void | Promise<void>
			canEvict?: (pool: pg.Pool) => boolean
		}
	) {}

	private searchPath(): string {
		if (
			this.config.searchPath.length < 1 ||
			this.config.searchPath.some((value) => !/^[a-z][a-z0-9_]{0,62}$/.test(value))
		)
			throw new Error('tenant pool search path is invalid')
		return [...this.config.searchPath, 'aven_platform', 'pg_catalog'].join(',')
	}

	async forGrant(grant: TenantGrantClaims): Promise<pg.Pool> {
		return this.forDestination(grant)
	}

	/** Call only after verifying the placement signature and runtime audience.
	 * No user/session is fabricated for background queue discovery. Physical
	 * placement is checked on every sweep, including with a cached connection.
	 */
	async forPlacement(placement: WorkerPlacement): Promise<pg.Pool> {
		workerPlacementSchema.parse(placement)
		const roles: Record<WorkerPlacement['componentRef'], string[]> = {
			'ceo.aven:component:data:intents@1': ['ceo.aven:db-role:intents:api@1'],
			'os.aven:component:actors:run-repository@1': [
				'os.aven:db-role:actors:api@1',
				'os.aven:db-role:actors:worker@1'
			]
		}
		if (
			placement.exp <= Date.now() / 1000 ||
			placement.iat > Date.now() / 1000 ||
			!roles[placement.componentRef].includes(this.config.roleKind)
		)
			throw Error('Worker placement has ended or does not authorize this role.')
		const pool = await this.forDestination(placement)
		const active = await pool.query(
			`SELECT 1 FROM aven_platform.environment_identity
			WHERE singleton AND environment_id=$1 AND routing_generation=$2 AND execution_enabled`,
			[placement.environmentId, placement.routingGeneration]
		)
		if (!active.rowCount) throw Error('Worker placement is no longer active.')
		return pool
	}

	private async forDestination(
		grant: Pick<
			TenantGrantClaims,
			'componentRef' | 'environmentId' | 'databaseName' | 'routingGeneration'
		>
	): Promise<pg.Pool> {
		if (grant.componentRef !== this.config.componentRef)
			throw new Error('tenant pool component mismatch')
		const component = customerComponentCatalog.find(
			(candidate) => candidate.componentRef === this.config.componentRef
		)
		if (!component) throw new Error('tenant pool component is absent from the pinned catalog')
		const key = [
			grant.environmentId,
			grant.databaseName,
			grant.routingGeneration,
			this.config.roleKind
		].join('\0')
		const now = Date.now()
		await this.evictIdle(now)
		const cached = this.pools.get(key)
		if (cached) {
			cached.lastUsed = now
			return cached.pool
		}
		while (this.pools.size >= (this.config.maxPools ?? 8)) await this.evictOldest()
		const user = databaseRoleName(grant.environmentId, this.config.roleSuffix)
		const password = deriveDatabasePassword({
			root: this.config.credentialRoot,
			environmentId: grant.environmentId,
			routingGeneration: grant.routingGeneration,
			roleKind: this.config.roleKind
		})
		const pool = new pg.Pool({
			host: this.config.host,
			port: this.config.port,
			database: grant.databaseName,
			user,
			password,
			ssl: this.config.ssl ? { rejectUnauthorized: true } : false,
			max: this.config.maxConnectionsPerPool ?? 2,
			connectionTimeoutMillis: 5_000,
			statement_timeout: 20_000,
			options: `-c search_path=${this.searchPath()}`
		})
		pool.on('error', () => {})
		try {
			const installation = (
				await pool.query<{
					schema_version: number
					migration_set_digest: string
					routing_generation: number
				}>(
					`SELECT schema_version,migration_set_digest,routing_generation
					 FROM aven_platform.component_installations WHERE component_ref=$1`,
					[grant.componentRef]
				)
			).rows[0]
			if (
				!installation ||
				Number(installation.routing_generation) !== grant.routingGeneration ||
				Number(installation.schema_version) < component.minimumRuntimeSchemaVersion ||
				Number(installation.schema_version) > component.maximumRuntimeSchemaVersion ||
				installation.migration_set_digest !== component.migrationSetDigest
			)
				throw new Error('customer component installation is incompatible')
		} catch (error) {
			await pool.end()
			throw error
		}
		const raced = this.pools.get(key)
		if (raced) {
			await pool.end()
			raced.lastUsed = now
			return raced.pool
		}
		this.pools.set(key, { pool, lastUsed: now })
		return pool
	}

	async invalidate(environmentId: string): Promise<void> {
		for (const [key, entry] of this.pools) {
			if (!key.startsWith(`${environmentId}\0`)) continue
			this.pools.delete(key)
			await this.config.onEvict?.(entry.pool)
			await entry.pool.end()
		}
	}

	async close(): Promise<void> {
		const entries = [...this.pools.values()]
		this.pools.clear()
		await Promise.all(
			entries.map(async (entry) => {
				await this.config.onEvict?.(entry.pool)
				return entry.pool.end()
			})
		)
	}

	private async evictIdle(now: number): Promise<void> {
		for (const [key, entry] of this.pools) {
			if (
				now - entry.lastUsed < (this.config.idleMilliseconds ?? 300_000) ||
				this.config.canEvict?.(entry.pool) === false
			)
				continue
			this.pools.delete(key)
			await this.config.onEvict?.(entry.pool)
			await entry.pool.end()
		}
	}

	private async evictOldest(): Promise<void> {
		const oldest = [...this.pools.entries()]
			.filter(([, entry]) => this.config.canEvict?.(entry.pool) !== false)
			.sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0]
		if (!oldest) throw new Error('All customer execution pools are busy; retry admission shortly.')
		this.pools.delete(oldest[0])
		await this.config.onEvict?.(oldest[1].pool)
		await oldest[1].pool.end()
	}
}
