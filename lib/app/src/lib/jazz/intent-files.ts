import { browser } from '$app/environment'
import { get } from 'svelte/store'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { deviceSession } from '$lib/self/device-session-store'
import { jazzBootstrap, jazzStatus, jazzTable } from '$lib/jazz/api'

/** Max binary size before base64 (v1 single text column). */
export const INTENT_FILE_MAX_BYTES = 15 * 1024 * 1024

const ALLOWED_MIME = new Set([
	'application/pdf',
	'image/jpeg',
	'image/png',
	'image/svg+xml',
])

function inferMimeFromFilename(name: string): string | null {
	const base = name.trim().toLowerCase()
	if (base.endsWith('.pdf')) return 'application/pdf'
	if (base.endsWith('.jpg') || base.endsWith('.jpeg')) return 'image/jpeg'
	if (base.endsWith('.png')) return 'image/png'
	if (base.endsWith('.svg')) return 'image/svg+xml'
	return null
}

/**
 * Resolved MIME for an allowed file, or error string.
 */
export function classifyIntentUploadFile(file: File): { ok: true; mime: string } | { ok: false; err: string } {
	if (file.size > INTENT_FILE_MAX_BYTES) {
		return {
			ok: false,
			err: `${file.name}: file too large (max ${Math.round(INTENT_FILE_MAX_BYTES / (1024 * 1024))} MiB)`,
		}
	}

	let mime = file.type.trim().toLowerCase()
	if (!mime) {
		mime = inferMimeFromFilename(file.name) ?? ''
	}
	if (!ALLOWED_MIME.has(mime)) {
		const fromName = inferMimeFromFilename(file.name)
		if (fromName && ALLOWED_MIME.has(fromName)) {
			mime = fromName
		} else {
			return {
				ok: false,
				err: `${file.name}: type not allowed (need PDF, JPEG, PNG, or SVG; got ${mime || 'unknown'})`,
			}
		}
	}
	return { ok: true, mime }
}

async function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const r = new FileReader()
		r.onload = () => {
			const s = r.result as string
			const i = s.indexOf(',')
			resolve(i >= 0 ? s.slice(i + 1) : s)
		}
		r.onerror = () => reject(r.error ?? new Error('FileReader failed'))
		r.readAsDataURL(file)
	})
}

/**
 * Persist composer attachments to Groove `files` table (Tauri + unlocked only).
 * `spark_id` is injected by the shell if omitted.
 */
export async function persistIntentFiles(
	intentId: string,
	files: File[],
): Promise<{ stored: number; errors: string[] }> {
	const errors: string[] = []
	if (!browser || !isTauriRuntime()) {
		return { stored: 0, errors }
	}
	if (get(deviceSession).kind !== 'unlocked') {
		return { stored: 0, errors: ['Device locked — unlock to store files in Groove.'] }
	}

	let stored = 0
	try {
		const status = await jazzStatus()
		if (!status.ready) await jazzBootstrap()
	} catch (e) {
		return {
			stored: 0,
			errors: [e instanceof Error ? e.message : String(e)],
		}
	}

	const api = jazzTable('files')
	const now = Date.now()

	for (const file of files) {
		const classified = classifyIntentUploadFile(file)
		if (!classified.ok) {
			errors.push(classified.err)
			continue
		}
		try {
			const content_b64 = await fileToBase64(file)
			await api.create({
				intent_id: intentId,
				filename: file.name,
				mime_type: classified.mime,
				size_bytes: file.size,
				created_at_ms: now,
				content_b64,
			})
			stored += 1
		} catch (e) {
			errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
		}
	}

	return { stored, errors }
}
