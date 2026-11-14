import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core'

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull().default(false),
	role: text('role').notNull().default('user'),
	image: text('image'),
	browserLanguage: text('browser_language'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const session = pgTable('session', {
	id: text('id').primaryKey(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	token: text('token').notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	setupTokenHash: text('setup_token_hash'),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' })
})

export const account = pgTable('account', {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
	refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
	scope: text('scope'),
	password: text('password'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const verification = pgTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true })
	},
	(table) => [index('verification_identifier_idx').on(table.identifier)]
)

export const passkey = pgTable(
	'passkey',
	{
		id: text('id').primaryKey(),
		name: text('name'),
		publicKey: text('public_key').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		credentialID: text('credential_id').notNull(),
		counter: integer('counter').notNull(),
		deviceType: text('device_type').notNull(),
		backedUp: boolean('backed_up').notNull(),
		transports: text('transports'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		aaguid: text('aaguid'),
		prfEnabled: boolean('prf_enabled').notNull().default(false)
	},
	(table) => [
		uniqueIndex('passkey_credential_id_unique').on(table.credentialID),
		index('passkey_user_id_idx').on(table.userId)
	]
)

export const setupLinks = pgTable('setup_links', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	tokenHash: text('token_hash').notNull().unique(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	lastUsedAt: timestamp('last_used_at', { withTimezone: true })
})

export const deviceCode = pgTable(
	'device_code',
	{
		id: text('id').primaryKey(),
		deviceCode: text('device_code').notNull(),
		userCode: text('user_code').notNull(),
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		status: text('status').notNull(),
		lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
		pollingInterval: integer('polling_interval'),
		clientId: text('client_id'),
		scope: text('scope')
	},
	(table) => [
		uniqueIndex('device_code_device_code_unique').on(table.deviceCode),
		uniqueIndex('device_code_user_code_unique').on(table.userCode)
	]
)

export const proofOfWorkRedemptions = pgTable('proof_of_work_redemptions', {
	id: text('id').primaryKey(),
	expiresAt: bigint('expires_at', { mode: 'number' }).notNull()
})

export const jwks = pgTable('jwks', {
	id: text('id').primaryKey(),
	publicKey: text('public_key').notNull(),
	privateKey: text('private_key').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
	alg: text('alg'),
	crv: text('crv')
})

// Better Auth oauth-provider models. Relying parties come from OIDC_CLIENTS through the
// plugin's client discovery, so oauthClient stays empty and read-only and client_id columns
// carry no foreign key. Refresh tokens, consents, resources and client assertions are never
// written (no offline_access, configured clients skip consent, no resources, public clients);
// the tables exist because the plugin reads them. See migrations/0005_oidc_provider.sql.
export const oauthClient = pgTable('oauth_client', {
	id: text('id').primaryKey(),
	clientId: text('client_id').notNull().unique(),
	clientSecret: text('client_secret'),
	clientDiscoveryId: text('client_discovery_id'),
	disabled: boolean('disabled').default(false),
	skipConsent: boolean('skip_consent'),
	enableEndSession: boolean('enable_end_session'),
	subjectType: text('subject_type'),
	scopes: text('scopes').array(),
	clientCredentialsScopes: text('client_credentials_scopes').array(),
	userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
	createdAt: timestamp('created_at', { withTimezone: true }),
	updatedAt: timestamp('updated_at', { withTimezone: true }),
	name: text('name'),
	uri: text('uri'),
	icon: text('icon'),
	contacts: text('contacts').array(),
	tos: text('tos'),
	policy: text('policy'),
	softwareId: text('software_id'),
	softwareVersion: text('software_version'),
	softwareStatement: text('software_statement'),
	redirectUris: text('redirect_uris').array().notNull(),
	postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
	backchannelLogoutUri: text('backchannel_logout_uri'),
	backchannelLogoutSessionRequired: boolean('backchannel_logout_session_required'),
	tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
	applicationType: text('application_type'),
	jwks: text('jwks'),
	jwksUri: text('jwks_uri'),
	grantTypes: text('grant_types').array(),
	responseTypes: text('response_types').array(),
	requirePKCE: boolean('require_pkce'),
	dpopBoundAccessTokens: boolean('dpop_bound_access_tokens').default(false),
	referenceId: text('reference_id'),
	metadata: jsonb('metadata')
})

export const oauthResource = pgTable('oauth_resource', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull().unique(),
	name: text('name').notNull(),
	accessTokenTtl: integer('access_token_ttl'),
	refreshTokenTtl: integer('refresh_token_ttl'),
	signingAlgorithm: text('signing_algorithm'),
	signingKeyId: text('signing_key_id'),
	allowedScopes: text('allowed_scopes').array(),
	customClaims: jsonb('custom_claims'),
	dpopBoundAccessTokensRequired: boolean('dpop_bound_access_tokens_required').default(false),
	disabled: boolean('disabled').default(false),
	createdAt: timestamp('created_at', { withTimezone: true }),
	updatedAt: timestamp('updated_at', { withTimezone: true }),
	policyVersion: integer('policy_version').default(1),
	metadata: jsonb('metadata')
})

export const oauthClientResource = pgTable(
	'oauth_client_resource',
	{
		id: text('id').primaryKey(),
		clientId: text('client_id').notNull(),
		resourceId: text('resource_id')
			.notNull()
			.references(() => oauthResource.identifier, { onDelete: 'cascade' }),
		metadata: jsonb('metadata'),
		createdAt: timestamp('created_at', { withTimezone: true })
	},
	(table) => [uniqueIndex('oauth_client_resource_unique').on(table.clientId, table.resourceId)]
)

export const oauthRefreshToken = pgTable(
	'oauth_refresh_token',
	{
		id: text('id').primaryKey(),
		token: text('token').notNull().unique(),
		clientId: text('client_id').notNull(),
		sessionId: text('session_id').references(() => session.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		referenceId: text('reference_id'),
		authorizationCodeId: text('authorization_code_id'),
		resources: text('resources').array(),
		requestedUserInfoClaims: text('requested_user_info_claims').array(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		revoked: timestamp('revoked', { withTimezone: true }),
		rotatedAt: timestamp('rotated_at', { withTimezone: true }),
		rotationReplayResponse: text('rotation_replay_response'),
		rotationReplayExpiresAt: timestamp('rotation_replay_expires_at', { withTimezone: true }),
		authTime: timestamp('auth_time', { withTimezone: true }),
		confirmation: jsonb('confirmation'),
		scopes: text('scopes').array().notNull()
	},
	(table) => [
		index('oauth_refresh_token_session_id_idx').on(table.sessionId),
		index('oauth_refresh_token_user_id_idx').on(table.userId),
		index('oauth_refresh_token_code_idx').on(table.authorizationCodeId)
	]
)

export const oauthAccessToken = pgTable(
	'oauth_access_token',
	{
		id: text('id').primaryKey(),
		token: text('token').notNull().unique(),
		clientId: text('client_id').notNull(),
		sessionId: text('session_id').references(() => session.id, { onDelete: 'cascade' }),
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		referenceId: text('reference_id'),
		authorizationCodeId: text('authorization_code_id'),
		resources: text('resources').array(),
		requestedUserInfoClaims: text('requested_user_info_claims').array(),
		refreshId: text('refresh_id').references(() => oauthRefreshToken.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		revoked: timestamp('revoked', { withTimezone: true }),
		confirmation: jsonb('confirmation'),
		scopes: text('scopes').array().notNull()
	},
	(table) => [
		index('oauth_access_token_session_id_idx').on(table.sessionId),
		index('oauth_access_token_user_id_idx').on(table.userId),
		index('oauth_access_token_code_idx').on(table.authorizationCodeId),
		index('oauth_access_token_refresh_id_idx').on(table.refreshId),
		index('oauth_access_token_expires_idx').on(table.expiresAt)
	]
)

export const oauthConsent = pgTable(
	'oauth_consent',
	{
		id: text('id').primaryKey(),
		clientId: text('client_id').notNull(),
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		referenceId: text('reference_id'),
		resources: text('resources').array(),
		requestedUserInfoClaims: text('requested_user_info_claims').array(),
		scopes: text('scopes').array().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true })
	},
	(table) => [index('oauth_consent_client_user_idx').on(table.clientId, table.userId)]
)

export const oauthClientAssertion = pgTable('oauth_client_assertion', {
	id: text('id').primaryKey(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
})

export const schema = {
	user,
	session,
	account,
	verification,
	passkey,
	setupLinks,
	deviceCode,
	proofOfWorkRedemptions,
	jwks,
	oauthClient,
	oauthResource,
	oauthClientResource,
	oauthRefreshToken,
	oauthAccessToken,
	oauthConsent,
	oauthClientAssertion
}
