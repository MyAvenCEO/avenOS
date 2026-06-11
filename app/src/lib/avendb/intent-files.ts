import { get } from 'svelte/store'
import { browser } from '$app/environment'
import { avenDbTable } from '$lib/avendb/api'
import { waitForAvenDbSessionReady } from '$lib/runtime/avendb-runtime'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { deviceSession } from '$lib/settings/device-session-store'

/** Max binary size before base64 encode (v1 single bytea column). */
export const INTENT_FILE_MAX_BYTES = 15 * 1024 * 1024

const ALLOWED_MIME = new Set([
	'application/pdf',
	'image/jpeg',
	'image/png',
	'image/svg+xml',
	'text/csv',
	'text/plain',
	'text/rtf',
	'application/rtf',
	'text/markdown'
])

function inferMimeFromFilename(name: string): string | null {
	const base = name.trim().toLowerCase()
	if (base.endsWith('.pdf')) return 'application/pdf'
	if (base.endsWith('.jpg') || base.endsWith('.jpeg')) return 'image/jpeg'
	if (base.endsWith('.png')) return 'image/png'
	if (base.endsWith('.svg')) return 'image/svg+xml'
	if (base.endsWith('.csv')) return 'text/csv'
	if (base.endsWith('.txt')) return 'text/plain'
	if (base.endsWith('.rtf')) return 'application/rtf'
	if (base.endsWith('.md') || base.endsWith('.markdown')) return 'text/markdown'
	return null
}

/**
 * Resolved MIME for an allowed file, or error string.
 */
export function classifyIntentUploadFile(
	file: File
): { ok: true; mime: string } | { ok: false; err: string } {
	if (file.size > INTENT_FILE_MAX_BYTES) {
		return {
			ok: false,
			err: `${file.name}: file too large (max ${Math.round(INTENT_FILE_MAX_BYTES / (1024 * 1024))} MiB)`
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
				err: `${file.name}: type not allowed (need PDF, image, CSV, TXT, RTF, or Markdown; got ${mime || 'unknown'})`
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
 * Persist attachments to avenDB `files` table (Tauri + unlocked only).
 * `parentId` is stored in `intent_id` (intent row id from composer, or message id from talk).
 * Pass `identityId` when the file belongs to a non-default identity (e.g. talk threads).
 */
export async function persistSparkFiles(
	parentId: string,
	files: File[],
	options?: { identityId?: string }
): Promise<{ stored: number; errors: string[] }> {
	const errors: string[] = []
	if (!browser || !isTauriRuntime()) {
		return { stored: 0, errors }
	}
	if (get(deviceSession).kind !== 'unlocked') {
		return { stored: 0, errors: ['Device locked — unlock to store files in avenDB.'] }
	}

	let stored = 0
	try {
		await waitForAvenDbSessionReady()
	} catch (e) {
		return {
			stored: 0,
			errors: [e instanceof Error ? e.message : String(e)]
		}
	}

	const api = avenDbTable('files')
	const now = Date.now()
	const identityId = options?.identityId?.trim()

	for (const file of files) {
		const classified = classifyIntentUploadFile(file)
		if (!classified.ok) {
			errors.push(classified.err)
			continue
		}
		try {
			const content = await fileToBase64(file)
			await api.create({
				...(identityId ? { owner: identityId } : {}),
				intent_id: parentId,
				filename: file.name,
				mime_type: classified.mime,
				size_bytes: file.size,
				created_at_ms: now,
				content
			})
			stored += 1
		} catch (e) {
			errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
		}
	}

	return { stored, errors }
}

/**
 * Persist composer attachments to avenDB `files` table (Tauri + unlocked only).
 * `owner` is injected by the shell if omitted.
 */
export async function persistIntentFiles(
	intentId: string,
	files: File[]
): Promise<{ stored: number; errors: string[] }> {
	return persistSparkFiles(intentId, files)
}
