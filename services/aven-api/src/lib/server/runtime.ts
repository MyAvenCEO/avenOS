import pino from 'pino'
import { ArtifactProcessingService } from './artifacts/processing.js'
import { ArtifactFileService } from './artifacts/service.js'
import { type AvenAuth, createAuth } from './auth.js'
import { createPaymentProvider } from './billing/fake.js'
import type { PaymentProvider } from './billing/provider.js'
import { SubscriptionService } from './billing/subscriptions.js'
import { loadApiConfig, type ServerConfig } from './config.js'
import { decodeEncryptionKey } from './crypto.js'
import { type DatabaseContext, openDatabase } from './db.js'
import type { QueueSettings } from './email/queue.js'
import { EnvironmentService } from './environments/service.js'
import { NameService } from './names/service.js'
import { createNotifier, type Notifier } from './notifications.js'
import { PasskeyService } from './passkeys.js'
import { ProofOfWorkService } from './proof-of-work.js'

export interface Runtime {
	config: ServerConfig
	logger: pino.Logger
	database: DatabaseContext
	queueSettings: QueueSettings
	notifier: Notifier
	auth: AvenAuth
	proofOfWork: ProofOfWorkService
	payments: PaymentProvider
	names: NameService
	subscriptions: SubscriptionService
	passkeys: PasskeyService
	environments: EnvironmentService
	artifacts: ArtifactFileService | null
	artifactProcessing: ArtifactProcessingService | null
	shutdown(): Promise<void>
}

const KEY = Symbol.for('aven.api.runtime')

async function create(): Promise<Runtime> {
	const config = loadApiConfig()
	const logger = pino({
		level: config.LOG_LEVEL,
		redact: {
			paths: ['password', 'token', 'secret', 'authorization', 'cookie'],
			censor: '[REDACTED]'
		}
	})
	const database = openDatabase(config.DATABASE_URL, {
		onError: (error) => logger.warn({ err: error.message }, 'database connection error')
	})
	const queueSettings: QueueSettings = {
		key: decodeEncryptionKey(config.EMAIL_QUEUE_ENCRYPTION_KEY),
		maxAttempts: config.EMAIL_MAX_ATTEMPTS
	}
	const notifier = createNotifier(config, queueSettings)
	const proofOfWork = new ProofOfWorkService(
		database.pool,
		config.POW_DIFFICULTY_BITS,
		config.POW_CHALLENGE_TTL_SECONDS
	)
	const payments = createPaymentProvider(config)
	const subscriptions = new SubscriptionService(database.pool, config, payments)
	const passkeys = new PasskeyService(database.pool, config.REQUIRE_PASSKEY_PRF)
	const environments = new EnvironmentService(database.pool)
	const artifacts = ArtifactFileService.fromConfig(config)
	const artifactProcessing = ArtifactProcessingService.fromConfig(config)
	const names = new NameService(
		database.pool,
		config,
		notifier,
		payments,
		(connection, userId) => passkeys.issueSetupLink(connection, userId),
		async (connection, input) => {
			await environments.enqueueProvision(connection, input)
		},
		(connection, input) => environments.enqueueSuspension(connection, input)
	)
	const auth = createAuth(config, database, {
		verifySetupLogin: (token) => passkeys.verifySetupLogin(token),
		verifyPurchaseLogin: (token) => names.verifyPurchaseSession(token)
	})
	if (payments.kind === 'fake') logger.warn('fake payments enabled')

	return {
		config,
		logger,
		database,
		queueSettings,
		notifier,
		auth,
		proofOfWork,
		payments,
		names,
		subscriptions,
		passkeys,
		environments,
		artifacts,
		artifactProcessing,
		async shutdown() {
			await database.pool.end()
		}
	}
}

export function runtime(): Promise<Runtime> {
	const holder = globalThis as Record<symbol, unknown>
	if (!holder[KEY]) holder[KEY] = create()
	return holder[KEY] as Promise<Runtime>
}
