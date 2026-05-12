import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'

import { json } from '@sveltejs/kit'

import type { RequestHandler } from './$types'
import { resolveJaensenWebApiBaseUrl } from '../_shared'

const UPLOAD_DIR = '/home/daniel/src/oMaiaCity/AvenOS/projects/aven-ceo/.data/jaensen-web-api-uploads'

type ClientAttachment = {
	name?: string
	contentType?: string
	base64?: string
}

export const POST: RequestHandler = async ({ request }) => {
	let raw: unknown
	try {
		raw = await request.json()
	} catch {
		return json({ error: 'Expected JSON body.' }, { status: 400 })
	}

	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return json({ error: 'Body must be an object.' }, { status: 400 })
	}

	const body = raw as {
		text?: string
		intentIdHint?: string
		attachments?: Array<{ id?: string; path?: string; mimeType?: string; name?: string }>
		attachment?: ClientAttachment
	}

	const text = typeof body.text === 'string' ? body.text.trim() : ''
	if (!text) {
		return json({ error: 'text is required.' }, { status: 400 })
	}

	const attachments = [
		...normalizeAttachmentDescriptors(body.attachments),
		...(body.attachment ? [await materializeAttachment(body.attachment)] : [])
	].filter(Boolean)

	const response = await fetch(`${resolveJaensenWebApiBaseUrl()}/api/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			text,
			intentIdHint: typeof body.intentIdHint === 'string' ? body.intentIdHint : undefined,
			attachments
		})
	})

	const payload = await response.text()
	return new Response(payload, {
		status: response.status,
		headers: {
			'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8'
		}
	})
}

function normalizeAttachmentDescriptors(value: unknown) {
	if (!Array.isArray(value)) return []
	return value.flatMap((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) return []
		const record = item as Record<string, unknown>
		const id = typeof record.id === 'string' && record.id ? record.id : randomUUID()
		return [
			{
				id,
				path: typeof record.path === 'string' ? record.path : undefined,
				mimeType: typeof record.mimeType === 'string' ? record.mimeType : undefined,
				name: typeof record.name === 'string' ? record.name : undefined
			}
		]
	})
}

async function materializeAttachment(attachment: ClientAttachment) {
	if (!attachment.base64) {
		return null
	}
	await mkdir(UPLOAD_DIR, { recursive: true })
	const id = randomUUID()
	const safeName = sanitizeFileName(attachment.name ?? 'upload.bin')
	const filePath = path.join(UPLOAD_DIR, `${id}-${safeName}`)
	await writeFile(filePath, Buffer.from(attachment.base64, 'base64'))
	return {
		id,
		path: filePath,
		mimeType: attachment.contentType,
		name: attachment.name ?? safeName
	}
}

function sanitizeFileName(name: string) {
	return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'upload.bin'
}