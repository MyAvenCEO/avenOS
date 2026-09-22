import { IdentityVerifier } from '@avenos/aven-identity'
import { BoundarySignals } from '@avenos/http-boundary'
import pg from 'pg'
import pino from 'pino'
import { ArtifactHandler } from './artifacts/handler.js'
import { PlatformCapabilities } from './capabilities.js'
import { loadFacadeConfig } from './config.js'
import { configuredConnections } from './connections/configured.js'
import { CustomerHandler } from './customers/handler.js'
import { CustomerStore } from './customers/store.js'
import { configuredWorkControl } from './customers/work-http.js'
import { createFacadeHandler } from './facade.js'
import { HostingHandler } from './hosting/handler.js'
import { HostingStore } from './hosting/store.js'
import { ArtifactFileService } from './lib/server/artifacts/service.js'
import { LlmGatewayService } from './lib/server/llm-gateway.js'
import { importFacadeTenantKeys } from './tenant-keys.js'

const config = loadFacadeConfig()
const logger = pino({ redact: ['req.headers.authorization', 'req.headers.cookie'] })
const hostingDatabase = new pg.Pool({
	connectionString: config.HOSTING_DATABASE_URL ?? config.DATABASE_URL,
	max: 3
})
const authorizationDatabase = new pg.Pool({
	connectionString: config.AUTHORIZATION_DATABASE_URL ?? config.DATABASE_URL,
	max: 3
})
const entitlementDatabase = new pg.Pool({
	connectionString: config.ENTITLEMENTS_DATABASE_URL ?? config.DATABASE_URL,
	max: 2
})
for (const database of [hostingDatabase, authorizationDatabase, entitlementDatabase])
	database.on('error', (error) => logger.error({ err: error }, 'API database pool error'))
const hosting = new HostingHandler(
	new HostingStore(hostingDatabase, {
		ipv4: config.SITE_HOST_PUBLIC_IPV4 || null,
		ipv6: config.SITE_HOST_PUBLIC_IPV6.split(',')
			.map((value) => value.trim())
			.filter(Boolean)
	}),
	config.SITE_HOST_DIRECTORY_BEARER_TOKEN
)
const tenantKeys = await importFacadeTenantKeys(config.TENANT_GRANT_PRIVATE_KEY)
const authorizationStore = new CustomerStore(authorizationDatabase, config.API_PUBLIC_BASE_URL)
const customers = new CustomerHandler(
	new CustomerStore(entitlementDatabase, config.API_PUBLIC_BASE_URL),
	authorizationStore,
	config.CUSTOMER_ENTITLEMENT_TOKEN,
	tenantKeys.privateKey
)
const workControl = configuredWorkControl(config, authorizationStore, tenantKeys)
const artifactService = ArtifactFileService.fromConfig(config)
const artifacts = artifactService ? new ArtifactHandler(artifactService) : undefined
const llmGateway = LlmGatewayService.fromConfig(config)
const identityVerifier = new IdentityVerifier({
	issuer: config.IDENTITY_ISSUER,
	jwksUrl: config.IDENTITY_JWKS_URL,
	audience: config.IDENTITY_AUDIENCE
})
const connections = await configuredConnections(
	config,
	identityVerifier,
	customers,
	tenantKeys.publicKey
)
const handler = createFacadeHandler(
	config,
	identityVerifier,
	fetch,
	hosting,
	customers,
	artifacts,
	llmGateway,
	workControl
)
const capabilities = new PlatformCapabilities(config, entitlementDatabase)
capabilities.start()
const boundary = new BoundarySignals('platform-to-facade-control', (summary) =>
	logger.warn(summary, 'Control boundary denials observed')
)
Bun.serve({
	maxRequestBodySize: 160 * 1024 * 1024,
	port: config.PORT,
	async fetch(request, server) {
		const path = new URL(request.url).pathname
		if (path === '/api/health/capabilities' || path === '/health/capabilities') {
			const result = capabilities.snapshot()
			return Response.json(result, {
				status: result.status === 'healthy' ? 200 : 503,
				headers: { 'cache-control': 'no-store' }
			})
		}
		if (path === '/api/health/live') return Response.json({ status: 'ok' })
		if (path === '/api/health/ready' || path === '/health/ready') {
			const ready = capabilities.snapshot().checks.database?.status === 'healthy'
			return Response.json(
				{ status: ready ? 'ready' : 'unavailable' },
				{ status: ready ? 200 : 503, headers: { 'cache-control': 'no-store' } }
			)
		}
		// Only authenticated, fully received model requests opt out of the HTTP
		// idle timer. The gateway owns their bounded queue + provider deadline;
		// a quiet prefill/reasoning interval must not truncate chunked transfer.
		const response =
			path.startsWith('/internal/v1/connections/') && connections
				? await connections(request)
				: await handler(request, () => server.timeout(request, 0))
		if (path.startsWith('/internal/'))
			boundary.record(response.status, server.requestIP(request)?.address)
		return response
	},
	error(error) {
		logger.error({ err: error }, 'facade request failed')
		return new Response('Service unavailable', { status: 500 })
	}
})
logger.info({ port: config.PORT }, 'aven-api facade listening')
