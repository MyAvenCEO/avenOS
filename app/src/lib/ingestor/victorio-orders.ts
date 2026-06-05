/**
 * App-side wiring for the generic @avenos/aven-skills ingestor: binds the
 * `victorio-pos-orders` config to browser ports (Web Crypto hash + a Groove
 * `files`-backed uploader) and exposes a single `ingestOrdersCsv` entry point that
 * returns the nested `Order[]` for the avenVICTORIO orders page.
 *
 * The ingestor instance is module-scoped, so re-importing the same (or an
 * overlapping) CSV during a session is idempotent — only genuinely new rows land.
 */

import {
	createIngestor,
	type IngestConfig,
	type IngestReport,
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
import type { Order } from '../../routes/avens/[projectId]/orders/orders-data'

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
const grooveUploader: UploaderPort = {
	async upload({ filename, mimeType, bytes, contentSha256 }) {
		const memId = `mem:${contentSha256.slice(0, 16)}`
		if (!browser || !isTauriRuntime() || get(deviceSession).kind !== 'unlocked') {
			return { fileId: memId }
		}
		try {
			await waitForGrooveSessionReady()
			const row = await jazzTable('files').create({
				intent_id: `ingest:${config.id}`,
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

const ingestor = createIngestor(config as unknown as IngestConfig, {
	ports: { hash: webCryptoHashPort, uploader: grooveUploader }
})

export interface OrdersImportResult {
	orders: Order[]
	report: IngestReport
}

/** Ingest one POS CSV file and return the full nested order list (all imports so far). */
export async function ingestOrdersCsv(file: File): Promise<OrdersImportResult> {
	const bytes = new Uint8Array(await file.arrayBuffer())
	const report = await ingestor.ingest({
		filename: file.name,
		mimeType: file.type || 'text/csv',
		bytes
	})
	return { orders: report.output.orders as unknown as Order[], report }
}

/** Current nested orders without ingesting anything new. */
export function currentOrders(): Order[] {
	return ingestor.output().orders as unknown as Order[]
}
