export interface DesignerScenario {
	id: string
	label: string
	href: string
}

export interface DesignerPage {
	label: string
	path: string
	scenarios: DesignerScenario[]
}

export const designerPages: DesignerPage[] = [
	{
		label: 'Name search',
		path: '/',
		scenarios: [
			{ id: 'empty', label: 'Empty', href: '/?scenario=empty' },
			{ id: 'checking', label: 'Checking', href: '/?scenario=checking' },
			{ id: 'available', label: 'Available', href: '/?scenario=available' },
			{ id: 'unavailable', label: 'Unavailable', href: '/?scenario=unavailable' },
			{ id: 'error', label: 'Error', href: '/?scenario=error' }
		]
	},
	{
		label: 'Checkout link',
		path: '/secure',
		scenarios: [
			{ id: 'form', label: 'Form', href: '/secure?name=aurora&scenario=form' },
			{ id: 'missing', label: 'Missing name', href: '/secure?scenario=missing' },
			{
				id: 'unavailable',
				label: 'Unavailable',
				href: '/secure?name=taken&scenario=unavailable'
			},
			{ id: 'sending', label: 'Sending', href: '/secure?name=aurora&scenario=sending' },
			{ id: 'sent', label: 'Sent', href: '/secure?name=aurora&scenario=sent' },
			{ id: 'error', label: 'Error', href: '/secure?name=aurora&scenario=error' }
		]
	},
	{
		label: 'Login',
		path: '/login',
		scenarios: [
			{ id: 'default', label: 'Default', href: '/login?scenario=default' },
			{
				id: 'invalid',
				label: 'Invalid access link',
				href: '/login?access=invalid&scenario=invalid'
			},
			{ id: 'waiting', label: 'Waiting', href: '/login?scenario=waiting' },
			{ id: 'error', label: 'Error', href: '/login?scenario=error' }
		]
	},
	{
		label: 'Connect device',
		path: '/device',
		scenarios: [
			{
				id: 'signed-out',
				label: 'Sign-in required',
				href: '/device?user_code=AVEN-2026&scenario=signed-out'
			},
			{
				id: 'signing-in',
				label: 'Signing in',
				href: '/device?user_code=AVEN-2026&scenario=signing-in'
			},
			{
				id: 'approval',
				label: 'Approval required',
				href: '/device?user_code=AVEN-2026&scenario=approval'
			},
			{
				id: 'approving',
				label: 'Approving',
				href: '/device?user_code=AVEN-2026&scenario=approving'
			},
			{ id: 'approved', label: 'Approved', href: '/device?user_code=AVEN-2026&scenario=approved' },
			{ id: 'error', label: 'Error', href: '/device?user_code=AVEN-2026&scenario=error' },
			{ id: 'missing', label: 'Missing code', href: '/device?scenario=missing' }
		]
	},
	{
		label: 'Create passkey',
		path: '/passkey/create',
		scenarios: [
			{ id: 'default', label: 'Default', href: '/passkey/create?scenario=default' },
			{ id: 'waiting', label: 'Waiting', href: '/passkey/create?scenario=waiting' },
			{ id: 'firefox', label: 'Firefox/Linux warning', href: '/passkey/create?scenario=firefox' },
			{
				id: 'firefox-error',
				label: 'Firefox/YubiKey error',
				href: '/passkey/create?scenario=firefox-error'
			},
			{
				id: 'android-error',
				label: 'Android provider error',
				href: '/passkey/create?scenario=android-error'
			},
			{ id: 'unsupported', label: 'Unsupported', href: '/passkey/create?scenario=unsupported' },
			{ id: 'error', label: 'Error', href: '/passkey/create?scenario=error' }
		]
	},
	{
		label: 'Download',
		path: '/dashboard',
		scenarios: [
			{ id: 'loading', label: 'Loading', href: '/dashboard?scenario=loading' },
			{ id: 'ready', label: 'Download ready', href: '/dashboard?scenario=ready' },
			{ id: 'error', label: 'Error', href: '/dashboard?scenario=error' }
		]
	},
	{
		label: 'Checkout',
		path: '/purchase/checkout',
		scenarios: [
			{
				id: 'creem-loading',
				label: 'Creem loading',
				href: '/purchase/checkout?token=designer&scenario=creem-loading'
			},
			{
				id: 'fake-ready',
				label: 'Fake ready',
				href: '/purchase/checkout?token=designer&scenario=fake-ready'
			},
			{
				id: 'fake-paying',
				label: 'Fake paying',
				href: '/purchase/checkout?token=designer&scenario=fake-paying'
			},
			{
				id: 'fake-error',
				label: 'Fake error',
				href: '/purchase/checkout?token=designer&scenario=fake-error'
			},
			{
				id: 'creem-ready',
				label: 'Creem ready',
				href: '/purchase/checkout?token=designer&scenario=creem-ready'
			},
			{
				id: 'creem-confirming',
				label: 'Creem confirming',
				href: '/purchase/checkout?token=designer&scenario=creem-confirming'
			}
		]
	},
	{
		label: 'Payment simulator',
		path: '/purchase/fake-checkout',
		scenarios: [
			{
				id: 'ready',
				label: 'Ready',
				href: '/purchase/fake-checkout?checkoutId=designer&holdId=designer-hold&name=aurora&email=alex%40example.com&successUrl=%2Fpurchase%2Fsuccess%3Fname%3Daurora&scenario=ready'
			},
			{
				id: 'missing',
				label: 'Missing input',
				href: '/purchase/fake-checkout?name=aurora&email=alex%40example.com&scenario=missing'
			},
			{
				id: 'processing',
				label: 'Processing',
				href: '/purchase/fake-checkout?checkoutId=designer&holdId=designer-hold&name=aurora&email=alex%40example.com&scenario=processing'
			},
			{
				id: 'error',
				label: 'Error',
				href: '/purchase/fake-checkout?checkoutId=designer&holdId=designer-hold&name=aurora&email=alex%40example.com&scenario=error'
			}
		]
	},
	{
		label: 'Payment complete',
		path: '/purchase/success',
		scenarios: [
			{
				id: 'confirming',
				label: 'Confirming',
				href: '/purchase/success?name=aurora&pt=designer&scenario=confirming'
			},
			{
				id: 'fallback',
				label: 'Email fallback',
				href: '/purchase/success?name=aurora&pt=designer&scenario=fallback'
			}
		]
	},
	{
		label: 'Expired link',
		path: '/purchase/expired',
		scenarios: [{ id: 'default', label: 'Default', href: '/purchase/expired?scenario=default' }]
	}
]

export function scenario(url: URL, fallback: string): string {
	return url.searchParams.get('scenario') || fallback
}

export function pageFor(pathname: string): DesignerPage | undefined {
	return designerPages.find((item) => item.path === pathname)
}
