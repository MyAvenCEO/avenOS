import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

declare const AVEN_BUNDLED: boolean

/** A replay pin must identify the executable, not Git HEAD (which may be dirty),
 * a manually maintained version string or only src/index.ts. Background service
 * execution requires the build command's single bundled entrypoint. */
export async function deployedChatEngineDigest(modelId: string): Promise<string> {
	if (typeof AVEN_BUNDLED === 'undefined' || !AVEN_BUNDLED)
		throw Error(
			'Build Actor Runner before enabling background Chat; source-watch execution has no immutable engine pin.'
		)
	const bytes = await readFile(Bun.main)
	return createHash('sha256')
		.update(bytes)
		.update(
			JSON.stringify({
				runtime: Bun.version,
				platform: process.platform,
				arch: process.arch,
				modelId
			})
		)
		.digest('hex')
}
