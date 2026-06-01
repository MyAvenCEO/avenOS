import { createAuthEndpoint } from '@better-auth/core/api'
import { generateId } from '@better-auth/core/utils/id'
import { verifyAsync } from '@noble/ed25519'
import type { BetterAuthPlugin, User } from 'better-auth'
import { APIError, getSessionFromCtx } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { generateRandomString } from 'better-auth/crypto'
import { mergeSchema } from 'better-auth/db'
import * as z from 'zod'
import { accountIdForDid, ed25519PublicKeyFromDid, providerIdForDid } from '$lib/did'
import type { AvenAuthEnv } from '$lib/env'
import {
	type AuthFlow,
	buildChallengeMessage,
	challengeExpiry,
	parseChallengeMessage
} from './challenge'
import { decodeSignature, hashInviteToken, syntheticEmailForDid } from './crypto'
import { avenAuthSchema } from './schema'

const SITE_CONFIG_ID = 'site'
const flowSchema = z.enum(['bootstrap', 'invite'])

type SiteConfigRow = {
	id: string
	adminUserId?: string | null
	bootstrappedAt?: Date | null
}

type InviteRow = {
	id: string
	tokenHash: string
	expiresAt: Date
	consumedAt?: Date | null
	boundDid?: string | null
	createdBy: string
	createdAt: Date
}

type ChallengeRow = {
	id: string
	nonce: string
	did: string
	flow: string
	inviteId?: string | null
	message: string
	expiresAt: Date
	usedAt?: Date | null
}

async function getSiteConfig(ctx: {
	context: { adapter: { findOne: Function } }
}): Promise<SiteConfigRow | null> {
	return (await ctx.context.adapter.findOne({
		model: 'selfSiteConfig',
		where: [{ field: 'id', operator: 'eq', value: SITE_CONFIG_ID }]
	})) as SiteConfigRow | null
}

async function ensureSiteConfigRow(ctx: {
	context: { adapter: { findOne: Function; create: Function } }
}) {
	const existing = await getSiteConfig(ctx)
	if (existing) return existing
	await ctx.context.adapter.create({
		model: 'selfSiteConfig',
		data: { id: SITE_CONFIG_ID },
		forceAllowId: true
	})
	const created = await getSiteConfig(ctx)
	if (!created) throw new Error('failed to initialize self_site_config')
	return created
}

async function findInviteByToken(
	ctx: { context: { adapter: { findOne: Function } } },
	token: string
): Promise<InviteRow | null> {
	return (await ctx.context.adapter.findOne({
		model: 'selfInvite',
		where: [{ field: 'tokenHash', operator: 'eq', value: hashInviteToken(token) }]
	})) as InviteRow | null
}

function inviteIsValid(invite: InviteRow, now = new Date()): boolean {
	if (invite.consumedAt) return false
	return now <= invite.expiresAt
}

export type AvenAuthPluginOptions = Pick<
	AvenAuthEnv,
	'domain' | 'networkSeed' | 'authUrl' | 'defaultInviteExpiresInSeconds' | 'inviteDeepLinkScheme'
>

export function avenAuth(options: AvenAuthPluginOptions) {
	return {
		id: 'aven-auth',
		schema: mergeSchema(avenAuthSchema, undefined),
		endpoints: {
			siteStatus: createAuthEndpoint('/aven-auth/site/status', { method: 'GET' }, async (ctx) => {
				const site = await getSiteConfig(ctx)
				const bootstrapped = Boolean(site?.adminUserId)
				return ctx.json({ bootstrapped, hasAdmin: bootstrapped })
			}),

			inviteCheck: createAuthEndpoint(
				'/aven-auth/invite/check',
				{
					method: 'GET',
					query: z.object({ token: z.string().min(8) })
				},
				async (ctx) => {
					const invite = await findInviteByToken(ctx, ctx.query.token)
					if (!invite || !inviteIsValid(invite)) {
						return ctx.json({ valid: false as const })
					}
					return ctx.json({
						valid: true as const,
						expiresAt: invite.expiresAt.toISOString()
					})
				}
			),

			inviteCreate: createAuthEndpoint(
				'/aven-auth/invite/create',
				{
					method: 'POST',
					body: z.object({
						expiresInSeconds: z.number().int().positive().optional()
					}),
					requireRequest: true
				},
				async (ctx) => {
					const session = await getSessionFromCtx(ctx)
					if (!session?.user?.id) {
						throw APIError.fromStatus('UNAUTHORIZED', {
							message: 'Authentication required',
							status: 401
						})
					}
					const site = await getSiteConfig(ctx)
					if (!site?.adminUserId || site.adminUserId !== session.user.id) {
						throw APIError.fromStatus('FORBIDDEN', {
							message: 'Only the site admin can create invites',
							status: 403
						})
					}

					const ttlMs = (ctx.body.expiresInSeconds ?? options.defaultInviteExpiresInSeconds) * 1000
					const rawToken = generateRandomString(32, 'a-z', 'A-Z', '0-9')
					const expiresAt = new Date(Date.now() + ttlMs)
					await ctx.context.adapter.create({
						model: 'selfInvite',
						data: {
							id: generateId(),
							tokenHash: hashInviteToken(rawToken),
							expiresAt,
							createdBy: session.user.id,
							createdAt: new Date()
						},
						forceAllowId: true
					})

					const inviteDeepLink = `${options.inviteDeepLinkScheme}://invite?invite=${encodeURIComponent(rawToken)}`
					return ctx.json({
						inviteToken: rawToken,
						inviteDeepLink,
						expiresAt: expiresAt.toISOString()
					})
				}
			),

			inviteList: createAuthEndpoint(
				'/aven-auth/invite/list',
				{ method: 'GET', requireRequest: true },
				async (ctx) => {
					const session = await getSessionFromCtx(ctx)
					if (!session?.user?.id) {
						throw APIError.fromStatus('UNAUTHORIZED', {
							message: 'Authentication required',
							status: 401
						})
					}
					const site = await getSiteConfig(ctx)
					if (!site?.adminUserId || site.adminUserId !== session.user.id) {
						throw APIError.fromStatus('FORBIDDEN', {
							message: 'Only the site admin can list invites',
							status: 403
						})
					}

					// Tokens are stored hashed — list only metadata + status (the redeemable
					// link is shown once at creation and cannot be recovered here).
					const rows = ((await ctx.context.adapter.findMany({ model: 'selfInvite' })) ??
						[]) as InviteRow[]
					const now = Date.now()
					const invites = rows
						.map((r) => {
							const expiresAt = new Date(r.expiresAt)
							const consumedAt = r.consumedAt ? new Date(r.consumedAt) : null
							const status = consumedAt ? 'claimed' : expiresAt.getTime() < now ? 'expired' : 'open'
							return {
								id: r.id,
								createdAt: new Date(r.createdAt).toISOString(),
								expiresAt: expiresAt.toISOString(),
								consumedAt: consumedAt ? consumedAt.toISOString() : null,
								boundDid: r.boundDid ?? null,
								status: status as 'open' | 'claimed' | 'expired'
							}
						})
						.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

					return ctx.json({ invites })
				}
			),

			nonce: createAuthEndpoint(
				'/aven-auth/nonce',
				{
					method: 'POST',
					body: z.object({
						did: z.string().min(1),
						flow: flowSchema,
						inviteToken: z.string().min(8).optional()
					})
				},
				async (ctx) => {
					const did = accountIdForDid(ctx.body.did)
					const flow = ctx.body.flow as AuthFlow
					const site = await ensureSiteConfigRow(ctx)
					const { providerId, accountId } = providerIdForDid(did)
					const existingAccount = await ctx.context.internalAdapter.findAccountByProviderId(
						accountId,
						providerId
					)

					let inviteId: string | undefined

					if (!existingAccount) {
						if (flow === 'bootstrap' && site.adminUserId) {
							throw APIError.fromStatus('FORBIDDEN', {
								message: 'Site already bootstrapped — use an invite link',
								status: 403
							})
						}

						if (flow === 'invite') {
							const token = ctx.body.inviteToken
							if (!token) {
								throw APIError.fromStatus('BAD_REQUEST', {
									message: 'inviteToken is required',
									status: 400
								})
							}
							const invite = await findInviteByToken(ctx, token)
							if (!invite || !inviteIsValid(invite)) {
								throw APIError.fromStatus('BAD_REQUEST', {
									message: 'Invalid or expired invite',
									status: 400
								})
							}
							inviteId = invite.id
						}
					}

					const nonce = generateRandomString(32, 'a-z', 'A-Z', '0-9')
					const issuedAt = new Date().toISOString()
					const expirationTime = challengeExpiry().toISOString()
					const message = buildChallengeMessage(options, {
						did,
						nonce,
						issuedAt,
						expirationTime
					})

					await ctx.context.adapter.create({
						model: 'selfChallenge',
						data: {
							id: generateId(),
							nonce,
							did,
							flow,
							inviteId,
							message,
							expiresAt: challengeExpiry()
						},
						forceAllowId: true
					})

					return ctx.json({ nonce, message })
				}
			),

			verify: createAuthEndpoint(
				'/aven-auth/verify',
				{
					method: 'POST',
					body: z.object({
						did: z.string().min(1),
						message: z.string().min(1),
						signature: z.string().min(1),
						flow: flowSchema,
						inviteToken: z.string().min(8).optional()
					}),
					requireRequest: true
				},
				async (ctx) => {
					const did = accountIdForDid(ctx.body.did)
					const flow = ctx.body.flow as AuthFlow
					const parsed = parseChallengeMessage(ctx.body.message)
					if (!parsed || parsed.did !== did) {
						throw APIError.fromStatus('UNAUTHORIZED', {
							message: 'Invalid challenge message',
							status: 401
						})
					}
					if (parsed.domain !== options.domain) {
						throw APIError.fromStatus('UNAUTHORIZED', {
							message: 'Challenge domain mismatch',
							status: 401
						})
					}
					if (parsed.network !== options.networkSeed) {
						throw APIError.fromStatus('UNAUTHORIZED', {
							message: 'Challenge network mismatch',
							status: 401
						})
					}
					if (new Date() > new Date(parsed.expirationTime)) {
						throw APIError.fromStatus('UNAUTHORIZED', { message: 'Challenge expired', status: 401 })
					}

					const challenge = (await ctx.context.adapter.findOne({
						model: 'selfChallenge',
						where: [{ field: 'nonce', operator: 'eq', value: parsed.nonce }]
					})) as ChallengeRow | null

					if (
						!challenge ||
						challenge.usedAt ||
						challenge.message !== ctx.body.message ||
						challenge.did !== did ||
						challenge.flow !== flow
					) {
						throw APIError.fromStatus('UNAUTHORIZED', {
							message: 'Invalid or used challenge',
							status: 401
						})
					}
					if (new Date() > challenge.expiresAt) {
						throw APIError.fromStatus('UNAUTHORIZED', { message: 'Challenge expired', status: 401 })
					}

					const publicKey = ed25519PublicKeyFromDid(did)
					const signature = decodeSignature(ctx.body.signature)
					const messageBytes = new TextEncoder().encode(ctx.body.message)
					const valid = await verifyAsync(signature, messageBytes, publicKey)
					if (!valid) {
						throw APIError.fromStatus('UNAUTHORIZED', { message: 'Invalid signature', status: 401 })
					}

					await ctx.context.adapter.update({
						model: 'selfChallenge',
						where: [{ field: 'id', operator: 'eq', value: challenge.id }],
						update: { usedAt: new Date() }
					})

					const { providerId, accountId } = providerIdForDid(did)
					const existingAccount = await ctx.context.internalAdapter.findAccountByProviderId(
						accountId,
						providerId
					)
					let user: User | null = existingAccount
						? ((await ctx.context.adapter.findOne({
								model: 'user',
								where: [{ field: 'id', operator: 'eq', value: existingAccount.userId }]
							})) as User | null)
						: null

					let isAdmin = false

					if (!user) {
						if (flow === 'bootstrap') {
							const site = await getSiteConfig(ctx)
							if (site?.adminUserId) {
								throw APIError.fromStatus('FORBIDDEN', {
									message: 'Site already bootstrapped — use an invite link',
									status: 403
								})
							}
						} else if (flow === 'invite') {
							const token = ctx.body.inviteToken
							if (!token) {
								throw APIError.fromStatus('BAD_REQUEST', {
									message: 'inviteToken is required',
									status: 400
								})
							}
							const invite = await findInviteByToken(ctx, token)
							if (!invite || !inviteIsValid(invite)) {
								throw APIError.fromStatus('BAD_REQUEST', {
									message: 'Invalid or expired invite',
									status: 400
								})
							}
							if (challenge.inviteId && challenge.inviteId !== invite.id) {
								throw APIError.fromStatus('BAD_REQUEST', {
									message: 'Invite mismatch',
									status: 400
								})
							}
							await ctx.context.adapter.update({
								model: 'selfInvite',
								where: [{ field: 'id', operator: 'eq', value: invite.id }],
								update: { consumedAt: new Date(), boundDid: did }
							})
						}

						const emailDomain = options.domain.includes(':')
							? 'auth.testnet.aven.ceo'
							: options.domain
						user = await ctx.context.internalAdapter.createUser({
							name: did,
							email: syntheticEmailForDid(did, emailDomain),
							emailVerified: true,
							createdAt: new Date(),
							updatedAt: new Date()
						})
						if (!user) {
							throw APIError.fromStatus('INTERNAL_SERVER_ERROR', {
								message: 'Failed to create user',
								status: 500
							})
						}

						await ctx.context.internalAdapter.createAccount({
							userId: user.id,
							providerId,
							accountId,
							createdAt: new Date(),
							updatedAt: new Date()
						})

						if (flow === 'bootstrap') {
							await ctx.context.adapter.update({
								model: 'selfSiteConfig',
								where: [{ field: 'id', operator: 'eq', value: SITE_CONFIG_ID }],
								update: { adminUserId: user.id, bootstrappedAt: new Date() }
							})
							isAdmin = true
						}
					} else {
						const site = await getSiteConfig(ctx)
						isAdmin = site?.adminUserId === user.id
					}

					const session = await ctx.context.internalAdapter.createSession(user.id)
					if (!session) {
						throw APIError.fromStatus('INTERNAL_SERVER_ERROR', {
							message: 'Failed to create session',
							status: 500
						})
					}
					await setSessionCookie(ctx, { session, user })

					return ctx.json({
						success: true,
						isAdmin,
						user: { id: user.id, did },
						token: session.token
					})
				}
			)
		}
	} satisfies BetterAuthPlugin
}
