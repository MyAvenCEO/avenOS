/**
 * App-side binding for the generic @avenos/aven-skills ingestor: it pairs the
 * `victorio-pos-orders` config with browser ports (Web Crypto hash + a Groove
 * `files`-backed uploader) and exposes a factory so the reactive store can wire in
 * live stage events / logging per run.
 */

import {
	createIngestor,
	type IngestConfig,
	type IngestorOptions,
	type UploaderPort,
	webCryptoHashPort
} from '@avenos/aven-skills'
import config from '@avenos/aven-skills/configs/victorio-pos-orders.json'
import { get } from 'svelte/store'
import { browser } from '$app/environment'
import { jazzTable } from '$lib/jazz/api'
import { waitForGrooveSessionReady } from '$lib/runtime/groove-runtime'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { deviceSession } from '$lib/settings/device-session-store'

export const ingestConfig = config as unknown as IngestConfig

function bytesToBase64(bytes: Uint8Array): string {
	let binary = ''
	const chunk = 0x8000
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
	}
	return btoa(binary)
}

/**
 * Persist the source CSV into the Groove `files` table (same table the attachment
 * upload service uses) when running in an unlocked Tauri session; otherwise return a
 * content-addressed in-memory id so the import still works in the web preview.
 */
export const grooveUploader: UploaderPort = {
	async upload({ filename, mimeType, bytes, contentSha256 }) {
		const memId = `mem:${contentSha256.slice(0, 16)}`
		if (!browser || !isTauriRuntime() || get(deviceSession).kind !== 'unlocked') {
			return { fileId: memId }
		}
		try {
			await waitForGrooveSessionReady()
			const row = await jazzTable('files').create({
				intent_id: `ingest:${ingestConfig.id}`,
				filename,
				mime_type: mimeType,
				size_bytes: bytes.length,
				created_at_ms: Date.now(),
				content: bytesToBase64(bytes)
			})
			return { fileId: row.id }
		} catch {
			// Storage is best-effort for provenance; never block the import on it.
			return { fileId: memId }
		}
	}
}

/** Build an ingestor bound to the Victorio config + browser ports, with optional run hooks. */
export function createOrdersIngestor(
	hooks: Pick<IngestorOptions, 'logger' | 'onStageEvent' | 'yield'> = {}
) {
	return createIngestor(ingestConfig, {
		ports: { hash: webCryptoHashPort, uploader: grooveUploader },
		...hooks
	})
}
