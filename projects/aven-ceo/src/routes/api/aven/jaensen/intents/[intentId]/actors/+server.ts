import type { RequestHandler } from './$types'
import { proxyJson } from '../../../_shared'

export const GET: RequestHandler = async ({ params }) =>
	proxyJson(`/api/intents/${encodeURIComponent(params.intentId)}/actors`)