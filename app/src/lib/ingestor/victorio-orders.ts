/**
 * App-side binding for the generic @avenos/aven-skills ingestor: it pairs the
 * `victorio-pos-orders` config with browser ports and exposes a factory so the
 * reactive store can wire in live stage events / logging per run.
 *
 * v1 is fully in-memory: the source CSV is NOT persisted to avenDB yet — the
 * uploader just returns a content-addressed id so provenance still works. To persist
 * the source later, swap `memoryUploaderPort()` for a avenDB `files`-backed uploader
 * (see git history for the avenDbTable('files') version).
 */

import {
	createIngestor,
	type IngestConfig,
	type IngestorOptions,
	memoryUploaderPort,
	webCryptoHashPort
} from '@avenos/aven-skills'
import config from '@avenos/aven-skills/configs/victorio-pos-orders.json'

export const ingestConfig = config as unknown as IngestConfig

/** Build an ingestor bound to the Victorio config + in-memory ports, with optional run hooks. */
export function createOrdersIngestor(
	hooks: Pick<IngestorOptions, 'logger' | 'onStageEvent' | 'yield'> = {}
) {
	return createIngestor(ingestConfig, {
		ports: { hash: webCryptoHashPort, uploader: memoryUploaderPort() },
		...hooks
	})
}
