// Compatibility redirect for claim links issued before checkout moved onto
// an Aven page. New email links point at /purchase/checkout directly.

import type { RequestEvent } from '@sveltejs/kit'
import { redirect } from '@sveltejs/kit'

export const GET = async (event: RequestEvent) => {
	const target = new URL('/purchase/checkout', event.url)
	target.searchParams.set('token', event.url.searchParams.get('token') ?? '')
	redirect(303, `${target.pathname}${target.search}`)
}
