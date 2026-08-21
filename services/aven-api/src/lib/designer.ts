import type {
	HealthStatus,
	MetaInfo,
	NameAvailability,
	NameHoldResult,
	PasskeyStatus
} from '$lib/types.js'

/** Statically replaced by Vite, so designer builds do not need runtime configuration. */
export const designerMode = import.meta.env.MODE === 'designer'

export interface DesignerPage {
	label: string
	href: string
	path: string
}

export const designerPages: DesignerPage[] = [
	{ label: 'Name search', href: '/', path: '/' },
	{ label: 'Checkout link', href: '/secure?name=aurora', path: '/secure' },
	{ label: 'Login', href: '/login?access=invalid', path: '/login' },
	{
		label: 'Connect device',
		href: '/device?user_code=AVEN-2026',
		path: '/device'
	},
	{ label: 'Create passkey', href: '/passkey/create', path: '/passkey/create' },
	{ label: 'Download', href: '/dashboard', path: '/dashboard' },
	{
		label: 'Checkout',
		href: '/purchase/checkout?token=designer-preview',
		path: '/purchase/checkout'
	},
	{
		label: 'Payment simulator',
		href:
			'/purchase/fake-checkout?checkoutId=designer-checkout&holdId=designer-hold&name=aurora&email=alex%40example.com&successUrl=%2Fpurchase%2Fsuccess%3Fname%3Daurora%26pt%3Ddesigner-token',
		path: '/purchase/fake-checkout'
	},
	{
		label: 'Payment complete',
		href: '/purchase/success?name=aurora&pt=designer-token',
		path: '/purchase/success'
	},
	{ label: 'Expired link', href: '/purchase/expired', path: '/purchase/expired' }
]

export const designerCheckout = {
	checkoutUrl:
		'https://designer.aven.invalid/purchase/fake-checkout?checkoutId=designer-checkout&holdId=designer-hold&name=aurora&email=alex%40example.com&successUrl=%2Fpurchase%2Fsuccess%3Fname%3Daurora%26pt%3Ddesigner-token',
	name: 'aurora',
	provider: 'fake' as const,
	priceEur: 25,
	reservationMinutes: 15
}

const meta: MetaInfo = {
	priceEur: 25,
	downloadUrl: '#designer-download',
	requirePasskeyPrf: true
}

const passkeys: PasskeyStatus = {
	passkeys: [
		{
			id: 'designer-passkey',
			name: 'MacBook Touch ID',
			device_type: 'multiDevice',
			backed_up: true,
			prf_enabled: true,
			created_at: '2026-08-21T10:00:00.000Z'
		}
	]
}

/** Browser-side API stand-in used only by the designer build. */
export async function designerApi<T>(path: string, options: RequestInit = {}): Promise<T> {
	const url = new URL(path, 'https://designer.aven.invalid')
	let result: unknown

	switch (url.pathname) {
		case '/names/check': {
			const name = (url.searchParams.get('name') || 'aurora').toLowerCase()
			result = {
				name,
				available: name !== 'taken',
				...(name === 'taken' ? { reason: 'NAME_TAKEN' as const } : {}),
				priceEur: 25,
				reservationMinutes: 15
			} satisfies NameAvailability
			break
		}
		case '/names/hold': {
			const body = JSON.parse(String(options.body ?? '{}')) as { name?: string }
			result = {
				hold: {
					name: body.name || 'aurora',
					expiresAt: '2026-08-21T15:30:00.000Z',
					priceEur: 25,
					reservationMinutes: 15
				} satisfies NameHoldResult
			}
			break
		}
		case '/passkeys':
			result = options.method === 'POST' ? { saved: true } : passkeys
			break
		case '/meta':
			result = meta
			break
		case '/billing/fake-pay': {
			const body = JSON.parse(String(options.body ?? '{}')) as { name?: string }
			result = {
				paid: true,
				redirect: `/purchase/success?name=${encodeURIComponent(body.name || 'aurora')}&pt=designer-token`
			}
			break
		}
		case '/health/status':
			result = {
				overall: 'healthy',
				capabilities: {
					authentication: true,
					emailQueueing: true,
					emailDelivery: 'available',
					environmentProvisioning: 'available'
				}
			} satisfies HealthStatus
			break
		default:
			throw new Error(`No designer mock exists for ${url.pathname}.`)
	}

	return result as T
}
