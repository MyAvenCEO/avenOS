/**
 * Network auth client for the `avenAuth` headless server (`libs/aven-auth`).
 *
 * Talks to the Better Auth `aven-auth` plugin endpoints to register / sign in this device's
 * Ed25519 signing identity:
 *   - `bootstrap` — the first identity becomes the sole site admin (also used for return sign-in)
 *   - `invite`    — a new identity redeeming a single-use invite token
 *
 * The device DID and signatures come from `tauri-plugin-self` (root secret must be unlocked).
 * Auth is carried as a Bearer token (the session token `verify` returns), persisted in
 * localStorage — cross-site cookies don't survive the Tauri webview → auth-server hop.
 */

import { invoke } from '@tauri-apps/api/core'

export type AuthFlow = 'bootstrap' | 'invite'

export type SiteStatus = { bootstrapped: boolean; hasAdmin: boolean }

export type InviteCheck = { valid: boolean; expiresAt?: string }

export type RegisterResult = {
	success: boolean
	isAdmin: boolean
	user: { id: string; did: string }
	token?: string
}

export type CreatedInvite = { inviteToken: string; inviteDeepLink: string; expiresAt: string }

export type InviteStatus = 'open' | 'claimed' | 'expired'

export type InviteSummary = {
	id: string
	createdAt: string
	expiresAt: string
	consumedAt: string | null
	boundDid: string | null
	status: InviteStatus
}

const LOCAL_DEFAULT = 'http://localhost:3000'
const PROD_DEFAULT = 'https://auth.testnet.aven.ceo'

/**
 * Base URL of the auth server. Defaults to the local dev server in dev and the testnet host in
 * prod; override with `VITE_AVEN_AUTH_URL` for local E2E against another port/host.
 */
export function resolveAuthBaseUrl(): string {
	const override = import.meta.env.VITE_AVEN_AUTH_URL as string | undefined
	if (override) return override.replace(/\/$/, '')
	return import.meta.env.DEV ? LOCAL_DEFAULT : PROD_DEFAULT
}

function apiUrl(path: string): string {
	return `${resolveAuthBaseUrl()}/api/auth/aven-auth/${path.replace(/^\//, '')}`
}

// The session is carried as a Bearer token (the value verify returns), not a cookie —
// cross-site cookies don't survive the Tauri webview → :3000 hop. Persisted so a reload
// keeps the session.
const TOKEN_KEY = 'aven-auth-session-token'

function getSessionToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_KEY)
	} catch {
		return null
	}
}

function setSessionToken(token: string): void {
	try {
		localStorage.setItem(TOKEN_KEY, token)
	} catch {
		/* storage unavailable — token stays in this page session only */
	}
}

export function clearSessionToken(): void {
	try {
		localStorage.removeItem(TOKEN_KEY)
	} catch {
		/* ignore */
	}
}

function authHeaders(): Record<string, string> {
	const token = getSessionToken()
	return token ? { authorization: `Bearer ${token}` } : {}
}

/** Encode raw bytes as base64url (no padding) — the form `decodeSignature` on the server accepts. */
function bytesToBase64Url(bytes: number[] | Uint8Array): string {
	const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
	let binary = ''
	for (const b of arr) binary += String.fromCharCode(b)
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function postJson<T>(path: string, body: unknown, opts?: { auth?: boolean }): Promise<T> {
	const res = await fetch(apiUrl(path), {
		method: 'POST',
		credentials: 'include',
		headers: {
			'content-type': 'application/json',
			origin: resolveAuthBaseUrl(),
			...(opts?.auth ? authHeaders() : {})
		},
		body: JSON.stringify(body)
	})
	if (!res.ok) {
		throw new Error(`${path} failed: ${res.status} ${await res.text()}`)
	}
	return (await res.json()) as T
}

export async function siteStatus(): Promise<SiteStatus> {
	const res = await fetch(apiUrl('site/status'), { credentials: 'include' })
	if (!res.ok) throw new Error(`site/status failed: ${res.status}`)
	return (await res.json()) as SiteStatus
}

export async function checkInvite(token: string): Promise<InviteCheck> {
	const res = await fetch(`${apiUrl('invite/check')}?token=${encodeURIComponent(token)}`, {
		credentials: 'include'
	})
	if (!res.ok) throw new Error(`invite/check failed: ${res.status}`)
	return (await res.json()) as InviteCheck
}

/**
 * Run the full nonce → sign → verify handshake for this device's signing identity.
 * Requires the identity to be unlocked (`signing_peer_did` / `sign` read the cached root secret).
 */
export async function register(opts: {
	flow: AuthFlow
	inviteToken?: string
}): Promise<RegisterResult> {
	const did = await invoke<string>('plugin:self|signing_peer_did')

	const { message } = await postJson<{ nonce: string; message: string }>('nonce', {
		did,
		flow: opts.flow,
		inviteToken: opts.inviteToken
	})

	const messageBytes = Array.from(new TextEncoder().encode(message))
	const signatureBytes = await invoke<number[]>('plugin:self|sign', { message: messageBytes })
	const signature = bytesToBase64Url(signatureBytes)

	const result = await postJson<RegisterResult>('verify', {
		did,
		message,
		signature,
		flow: opts.flow,
		inviteToken: opts.inviteToken
	})
	if (result.token) setSessionToken(result.token)
	return result
}

/** Admin only — mint a new single-use invite. Returns the redeemable link (shown once). */
export async function createInvite(expiresInSeconds?: number): Promise<CreatedInvite> {
	return await postJson<CreatedInvite>(
		'invite/create',
		expiresInSeconds ? { expiresInSeconds } : {},
		{
			auth: true
		}
	)
}

/** Admin only — list all invites with their status (open / claimed / expired). */
export async function listInvites(): Promise<InviteSummary[]> {
	const res = await fetch(apiUrl('invite/list'), {
		credentials: 'include',
		headers: authHeaders()
	})
	if (!res.ok) throw new Error(`invite/list failed: ${res.status}`)
	const data = (await res.json()) as { invites: InviteSummary[] }
	return data.invites
}
