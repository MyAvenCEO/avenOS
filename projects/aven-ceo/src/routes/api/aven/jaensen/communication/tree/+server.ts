import { error } from '@sveltejs/kit'

import type { RequestHandler } from './$types'

import { proxyJson } from '../../_shared'

export const GET: RequestHandler = async ({ url }) => {
	const query = new URLSearchParams()
	for (const key of ['correlationId', 'intentId', 'rootEnvelopeId', 'view', 'nodeId'] as const) {
		const value = url.searchParams.get(key)
		if (value) query.set(key, value)
	}
	if (![query.get('correlationId'), query.get('intentId'), query.get('rootEnvelopeId')].some(Boolean)) {
		throw error(400, 'Missing correlationId, intentId, or rootEnvelopeId')
	}
	return proxyJson(`/api/communication/tree?${query.toString()}`)
}