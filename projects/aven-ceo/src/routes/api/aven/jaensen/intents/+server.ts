import type { RequestHandler } from './$types'
import { proxyJson } from '../_shared'

export const GET: RequestHandler = async () => proxyJson('/api/intents')