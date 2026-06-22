import { getBearerToken } from '$lib/auth/auth-client'

// Client for the E2EE secrets vault (board 0055). Every payload is already ciphertext / wrapped
// key / salt / nonce — the server is blind. Session + tier (>= avenFOUNDER) gated server-side.
const BASE = import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	if (!BASE) throw new Error('auth server URL not configured')
	const token = getBearerToken()
	const res = await fetch(`${BASE}${path}`, {
		...init,
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(init?.headers ?? {})
		}
	})
	if (!res.ok) {
		const err = (await res.json().catch(() => null)) as { error?: string } | null
		throw new Error(err?.error || `HTTP ${res.status}`)
	}
	return res.json() as Promise<T>
}

export type VaultRow = {
	id: string
	credential_id: string
	prf_salt: string
	wrapped_master_key: string
	wrap_nonce: string
	alg: string
}

export type SecretRow = {
	id: string
	kind: string
	label: string | null
	ciphertext: string
	nonce: string
	alg: string
}

export async function getVault(): Promise<VaultRow | null> {
	const { vault } = await api<{ vault: VaultRow | null }>('/api/vault')
	return vault
}

export async function putVault(v: {
	credentialId: string
	prfSalt: string
	wrappedMasterKey: string
	wrapNonce: string
	alg: string
}): Promise<string> {
	const { id } = await api<{ id: string }>('/api/vault', {
		method: 'POST',
		body: JSON.stringify(v)
	})
	return id
}

export async function listSecrets(): Promise<SecretRow[]> {
	const { secrets } = await api<{ secrets: SecretRow[] }>('/api/vault/secrets')
	return secrets
}

export async function putSecret(s: {
	kind: string
	label?: string | null
	ciphertext: string
	nonce: string
	alg: string
}): Promise<string> {
	const { id } = await api<{ id: string }>('/api/vault/secrets', {
		method: 'POST',
		body: JSON.stringify(s)
	})
	return id
}

export async function deleteSecret(id: string): Promise<void> {
	await api(`/api/vault/secrets/${id}`, { method: 'DELETE' })
}
