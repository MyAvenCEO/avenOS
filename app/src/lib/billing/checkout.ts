import { getBearerToken } from '$lib/auth/auth-client'

// Auth/billing server origin (same server as the AI proxy + Better Auth). board 0052.
const BASE = import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined

/**
 * Start a Polar checkout for the signed-in user and redirect the browser to it.
 *
 * The pricing UI is ours; the actual card entry is Polar's hosted, PCI-compliant page.
 * Our server creates the session with `external_customer_id = user.id`, so the purchase is
 * tied back to this user and the webhook can sync the tier. Throws on any non-OK response
 * so the caller can surface the error.
 *
 * @param tier optional tier name (e.g. 'avenFOUNDER'); defaults server-side to avenCITY.
 */
export async function startCheckout(tier?: string): Promise<void> {
	if (!BASE) throw new Error('billing server URL not configured')
	const token = getBearerToken()
	// Return the customer to OUR app after paying, on a real routeable screen. The `?checkout=
	// success` flag tells the shell to reconcile the tier (see MainnetShell) so credits show at once.
	const returnUrl =
		typeof window !== 'undefined' ? `${window.location.origin}/?checkout=success` : undefined
	const res = await fetch(`${BASE}/api/billing/checkout`, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		body: JSON.stringify({
			...(tier ? { tier } : {}),
			...(returnUrl ? { returnUrl } : {})
		})
	})
	if (!res.ok) {
		const err = (await res.json().catch(() => null)) as { error?: string } | null
		throw new Error(err?.error ? err.error : `HTTP ${res.status}`)
	}
	const { url } = (await res.json()) as { url?: string }
	if (!url) throw new Error('no_checkout_url')
	// Force the hosted checkout to LIGHT to match avenOS's brand (cream/navy). Without this,
	// Polar follows the webview's prefers-color-scheme — dark on a dark-mode Mac — which
	// clashes with our light app. (theme is the only color lever on the hosted page.)
	const themed = `${url}${url.includes('?') ? '&' : '?'}theme=light`
	// Full-page redirect to Polar's hosted checkout; on success Polar redirects back to
	// `returnUrl` (our app), where the shell reconciles the new entitlement.
	window.location.href = themed
}

/**
 * Reconcile the signed-in user's tier with Polar on demand (pulls their customer state
 * server-side → updates `tier`). Call after returning from checkout so the new plan and
 * weekly MINDS appear immediately — without waiting on a webhook. Returns the resolved tier
 * (or null on failure). Never throws.
 */
export async function syncBilling(): Promise<string | null> {
	if (!BASE) return null
	const token = getBearerToken()
	try {
		const res = await fetch(`${BASE}/api/billing/sync`, {
			method: 'POST',
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {})
			}
		})
		if (!res.ok) return null
		const { tier } = (await res.json()) as { tier?: string }
		return tier ?? null
	} catch {
		return null
	}
}

// --- Self-service plan management (subscriptions + orders + cancel/resume), all via our API ---

export type BillingSubscription = {
	id: string
	productId: string
	tier: string | null
	status: string
	amount: number // cents
	currency: string
	recurringInterval: string
	currentPeriodEnd: string // ISO
	cancelAtPeriodEnd: boolean
	endsAt: string | null
}

export type BillingOrder = {
	id: string
	createdAt: string // ISO
	status: string
	paid: boolean
	amount: number // cents
	currency: string
	billingReason: string
	productId: string | null
}

export type BillingState = {
	tier: string
	/** Skill names granted to the user, from Polar feature-flag benefits (the entitlement source). */
	skills: string[]
	subscriptions: BillingSubscription[]
	orders: BillingOrder[]
}

function authHeaders(): Record<string, string> {
	const token = getBearerToken()
	return {
		'Content-Type': 'application/json',
		...(token ? { Authorization: `Bearer ${token}` } : {})
	}
}

/**
 * Fetch an order's invoice PDF (proxied through our server to stay within CSP) and return a
 * `blob:` URL usable in an <iframe> preview and an <a download>. Caller must revoke it later.
 * Returns null on failure.
 */
export async function fetchInvoiceBlobUrl(orderId: string): Promise<string | null> {
	if (!BASE) return null
	const token = getBearerToken()
	try {
		const res = await fetch(`${BASE}/api/billing/orders/${orderId}/invoice`, {
			credentials: 'include',
			headers: token ? { Authorization: `Bearer ${token}` } : {}
		})
		if (!res.ok) return null
		const blob = await res.blob()
		return URL.createObjectURL(blob)
	} catch {
		return null
	}
}

/** Fetch the signed-in user's subscriptions + orders (live from Polar via our server). */
export async function fetchBillingState(): Promise<BillingState | null> {
	if (!BASE) return null
	try {
		const res = await fetch(`${BASE}/api/billing/state`, {
			credentials: 'include',
			headers: authHeaders()
		})
		if (!res.ok) return null
		return (await res.json()) as BillingState
	} catch {
		return null
	}
}

/**
 * Cancel (downgrade to free) the user's active subscription. `period_end` (default) keeps
 * access until renewal; `immediate` revokes now. Returns the resolved tier. Throws on failure.
 */
export async function cancelSubscription(
	mode: 'period_end' | 'immediate' = 'period_end'
): Promise<string | null> {
	if (!BASE) throw new Error('billing server URL not configured')
	const res = await fetch(`${BASE}/api/billing/cancel`, {
		method: 'POST',
		credentials: 'include',
		headers: authHeaders(),
		body: JSON.stringify({ mode })
	})
	if (!res.ok) {
		const err = (await res.json().catch(() => null)) as { error?: string } | null
		throw new Error(err?.error ?? `HTTP ${res.status}`)
	}
	const { tier } = (await res.json()) as { tier?: string }
	return tier ?? null
}

/**
 * Switch the active subscription to another paid tier (upgrade/downgrade). Polar prorates per
 * the org default. Returns the resolved tier. Throws on failure (incl. 404 when there's no
 * active subscription — the caller should fall back to checkout for a free → paid move).
 */
export async function switchSubscription(tier: string): Promise<string | null> {
	if (!BASE) throw new Error('billing server URL not configured')
	const res = await fetch(`${BASE}/api/billing/switch`, {
		method: 'POST',
		credentials: 'include',
		headers: authHeaders(),
		body: JSON.stringify({ tier })
	})
	if (!res.ok) {
		const err = (await res.json().catch(() => null)) as { error?: string } | null
		throw new Error(err?.error ?? `HTTP ${res.status}`)
	}
	const { tier: resolved } = (await res.json()) as { tier?: string }
	return resolved ?? null
}

/** Reverse a scheduled cancellation (resume the subscription). Throws on failure. */
export async function uncancelSubscription(): Promise<string | null> {
	if (!BASE) throw new Error('billing server URL not configured')
	const res = await fetch(`${BASE}/api/billing/uncancel`, {
		method: 'POST',
		credentials: 'include',
		headers: authHeaders()
	})
	if (!res.ok) {
		const err = (await res.json().catch(() => null)) as { error?: string } | null
		throw new Error(err?.error ?? `HTTP ${res.status}`)
	}
	const { tier } = (await res.json()) as { tier?: string }
	return tier ?? null
}
