// Deploy the composer site to a live Tigris bucket. Reuses buildSite(src) to assemble public/ (with
// ${BASE_URL} resolved to the content host) and uploads every object through a storagesdk Storage.
// SERVER-ONLY (imports @storagesdk) — kept OFF the composer barrel so the browser preview never pulls
// it. The betterauth confirm handler calls this after the HITL "Publish?" gate. board 0058.
import { tigris } from '@storagesdk/adapters/tigris'
import { Storage } from '@storagesdk/core'
import { buildSite } from './site-generator'

/** The minimal upload surface deploySite needs — the real storagesdk Storage and a test mock both fit. */
export type DeployStorage = {
	upload(
		key: string,
		body: string,
		opts?: { contentType?: string; cacheControl?: string }
	): Promise<unknown>
}

export type DeployResult = { count: number; url: string }

const DEFAULT_HOST = 'https://www.next.aven.ceo'
const CACHE = 'public, max-age=300'

/**
 * Assemble the site from `src` (with `${BASE_URL}` → `opts.host`) and upload every object to the given
 * storage. Storage is injected so the logic is fully testable with a mock — no live creds needed.
 */
export async function deploySite(
	src: Record<string, string>,
	storage: DeployStorage,
	opts: { host?: string; cacheControl?: string } = {}
): Promise<DeployResult> {
	const host = opts.host ?? DEFAULT_HOST
	const cacheControl = opts.cacheControl ?? CACHE
	const objects = buildSite(src, { baseUrl: host })
	for (const o of objects) {
		await storage.upload(o.key, o.body, { contentType: o.contentType, cacheControl })
	}
	return { count: objects.length, url: `${host}/en/` }
}

/** The content host the deploy publishes to (SITE_HOST or the next.aven.ceo default). */
export const deployHost = (): string => process.env.SITE_HOST ?? DEFAULT_HOST

/**
 * Build a live Tigris Storage from the Fly-Tigris env (AWS_* + BUCKET_NAME), or null if unconfigured
 * (so the confirm handler can return a clean "deploy not configured" instead of throwing). board 0058.
 */
export function tigrisStorageFromEnv(): DeployStorage | null {
	const bucket = process.env.BUCKET_NAME
	const accessKeyId = process.env.AWS_ACCESS_KEY_ID
	const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
	if (!bucket || !accessKeyId || !secretAccessKey) return null
	return new Storage({
		adapter: tigris({
			bucket,
			accessKeyId,
			secretAccessKey,
			endpoint: process.env.AWS_ENDPOINT_URL_S3 ?? 'https://fly.storage.tigris.dev'
		})
	})
}
