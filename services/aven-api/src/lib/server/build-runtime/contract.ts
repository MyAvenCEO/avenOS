import type { Handle, RequestEvent } from '@sveltejs/kit'

export interface CheckoutData {
	checkoutUrl: string
	name: string
	provider: 'fake' | 'creem'
	priceEur: number
	reservationMinutes: number
}

export interface ServerBuildRuntime {
	handle: Handle
	loadCheckout(event: RequestEvent): Promise<CheckoutData>
}
