import pino from 'pino'
import { AccountService } from './accounts.js'
import { createAuth, type IdentityAuth } from './auth.js'
import { type IdentityConfig, loadIdentityConfig } from './config.js'
import { type DatabaseContext, openDatabase } from './db.js'
import { PasskeyService } from './passkeys.js'
import { ProofOfWorkService } from './proof-of-work.js'

export interface IdentityRuntime {
	config: IdentityConfig
	database: DatabaseContext
	auth: IdentityAuth
	accounts: AccountService
	authorizations: AccountService
	passkeys: PasskeyService
	proofOfWork: ProofOfWorkService
	logger: pino.Logger
}
const KEY = Symbol.for('aven.identity.runtime')
async function create(): Promise<IdentityRuntime> {
	const config = loadIdentityConfig()
	const database = openDatabase(config.DATABASE_URL)
	const accounts = openDatabase(config.ACCOUNTS_DATABASE_URL ?? config.DATABASE_URL, 2)
	const authorizations = openDatabase(config.AUTHORIZATION_DATABASE_URL ?? config.DATABASE_URL, 2)
	const passkeys = new PasskeyService(database.pool, config.REQUIRE_PASSKEY_PRF)
	return {
		config,
		database,
		passkeys,
		accounts: new AccountService(accounts.pool),
		authorizations: new AccountService(authorizations.pool),
		auth: createAuth(config, database, (token) => passkeys.verifySetupLink(token)),
		proofOfWork: new ProofOfWorkService(
			database.pool,
			config.POW_DIFFICULTY_BITS,
			config.POW_CHALLENGE_TTL_SECONDS
		),
		logger: pino({
			level: config.LOG_LEVEL,
			redact: ['req.headers.authorization', 'req.headers.cookie', 'token', 'secret']
		})
	}
}
export function runtime(): Promise<IdentityRuntime> {
	const holder = globalThis as Record<symbol, unknown>
	holder[KEY] ??= create()
	return holder[KEY] as Promise<IdentityRuntime>
}
