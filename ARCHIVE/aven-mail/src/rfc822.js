/**
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {string}
 */
function bytesToUtf8(bytes) {
	const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
	return new TextDecoder('utf-8', { fatal: false }).decode(u8)
}

/**
 * @param {string} headerBlock
 * @returns {Map<string, string>}
 */
export function parseRfc822Headers(headerBlock) {
	const lines = headerBlock.split(/\r?\n/)
	/** @type {Map<string, string>} */
	const headers = new Map()
	let currentKey = ''
	for (const line of lines) {
		if (/^[ \t]/.test(line) && currentKey) {
			const prev = headers.get(currentKey) ?? ''
			headers.set(currentKey, `${prev} ${line.trim()}`)
			continue
		}
		const m = /^([^:]+):\s*(.*)$/.exec(line)
		if (m) {
			currentKey = m[1].trim().toLowerCase()
			headers.set(currentKey, m[2].trim())
		}
	}
	return headers
}

/**
 * @param {string} disposition
 * @returns {string | null}
 */
function filenameFromContentDisposition(disposition) {
	const star = /filename\*=\s*[^']*''([^;\s]+)/i.exec(disposition)
	if (star) {
		try {
			return decodeURIComponent(star[1])
		} catch {
			return star[1]
		}
	}
	const q = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(disposition)
	if (q) return q[1].replace(/\\(.)/g, '$1')
	const uq = /filename\s*=\s*([^;\s]+)/i.exec(disposition)
	if (uq) return uq[1].replace(/^"|"$/g, '')
	return null
}

/**
 * @param {string} contentType
 * @returns {string | null}
 */
function nameFromContentType(contentType) {
	const q = /name\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(contentType)
	if (q) return q[1].replace(/\\(.)/g, '$1')
	const uq = /name\s*=\s*([^;\s]+)/i.exec(contentType)
	if (uq) return uq[1].replace(/^"|"$/g, '')
	return null
}

/**
 * @param {Map<string, string>} headers
 * @returns {string | null}
 */
function attachmentFilenameFromPartHeaders(headers) {
	const disp = headers.get('content-disposition')
	const ctype = headers.get('content-type') ?? ''
	if (disp) {
		const fn = filenameFromContentDisposition(disp)
		if (fn) return fn
	}
	return nameFromContentType(ctype)
}

/**
 * @param {string} contentType
 * @returns {string | null}
 */
function extractBoundaryFromContentType(contentType) {
	const m = /boundary\s*=\s*(?:"([^"]+)"|([^";\s][^;\s]*))/i.exec(contentType)
	if (!m) return null
	return (m[1] || m[2] || '').trim()
}

/**
 * @param {string} body
 * @param {string} boundary
 * @returns {string[]}
 */
function splitMultipartParts(body, boundary) {
	const marker = `--${boundary}`
	const len = body.length
	/** @type {string[]} */
	const parts = []

	function markerAt(pos) {
		if (body.startsWith(marker, pos)) return pos
		const n = body.indexOf(`\n${marker}`, pos)
		if (n !== -1) return n + 1
		const rn = body.indexOf(`\r\n${marker}`, pos)
		if (rn !== -1) return rn + 2
		return -1
	}

	let i = 0
	while (i < len) {
		const ms = markerAt(i)
		if (ms === -1) break
		i = ms + marker.length
		if (i < len && body[i] === '-' && i + 1 < len && body[i + 1] === '-') {
			break
		}
		if (i < len && body[i] === '\r') i++
		if (i < len && body[i] === '\n') i++
		const partStart = i
		const nextM = markerAt(partStart)
		let slice = nextM === -1 ? body.slice(partStart) : body.slice(partStart, nextM)
		slice = slice.replace(/\r?\n$/, '')
		if (slice.length) parts.push(slice)
		if (nextM === -1) break
		i = nextM
	}
	return parts
}

/**
 * @param {string} part
 * @returns {{ headerText: string, body: string }}
 */
function splitPartHeadersAndBody(part) {
	let pe = part.indexOf('\r\n\r\n')
	let off = 4
	if (pe === -1) {
		pe = part.indexOf('\n\n')
		off = 2
	}
	if (pe === -1) return { headerText: part, body: '' }
	return { headerText: part.slice(0, pe), body: part.slice(pe + off) }
}

/**
 * @param {Map<string, string>} headers
 * @returns {boolean}
 */
function isAttachmentDisposition(headers) {
	const disp = headers.get('content-disposition') ?? ''
	return /\battachment\b/i.test(disp)
}

/**
 * @param {Map<string, string>} headers
 * @returns {boolean}
 */
function isLikelyAttachmentPart(headers) {
	if (isAttachmentDisposition(headers)) return true
	const ct = headers.get('content-type') ?? ''
	const fn = attachmentFilenameFromPartHeaders(headers)
	if (fn && !/^text\/plain\b/i.test(ct)) return true
	if (/^application\/pdf\b/i.test(ct)) return true
	if (/^application\/octet-stream\b/i.test(ct) && fn) return true
	return false
}

/**
 * @param {string} headerBlock
 * @param {string} body
 * @returns {Array<{ headers: Map<string, string>, body: string }>}
 */
function flattenMimeParts(headerBlock, body) {
	const headers = parseRfc822Headers(headerBlock)
	const ct = headers.get('content-type') ?? ''
	const boundary = extractBoundaryFromContentType(ct)
	if (boundary && /multipart\s*\//i.test(ct)) {
		/** @type {Array<{ headers: Map<string, string>, body: string }>} */
		const out = []
		for (const chunk of splitMultipartParts(body, boundary)) {
			const { headerText, body: innerBody } = splitPartHeadersAndBody(chunk)
			out.push(...flattenMimeParts(headerText, innerBody))
		}
		return out
	}
	return [{ headers, body }]
}

/**
 * @param {string} qp
 * @returns {string}
 */
function decodeQuotedPrintable(qp) {
	return qp
		.replace(/=\r?\n/g, '')
		.replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
}

/**
 * @param {Map<string, string>} headers
 * @param {string} bodyText
 * @returns {Uint8Array}
 */
export function decodeMimePartBytes(headers, bodyText) {
	const cte = (headers.get('content-transfer-encoding') ?? '7bit').toLowerCase().trim()
	const trimmed = bodyText.replace(/\r\n/g, '\n').trimEnd()
	if (cte === 'base64') {
		const b64 = trimmed.replace(/\s/g, '')
		return Uint8Array.from(Buffer.from(b64, 'base64'))
	}
	if (cte === 'quoted-printable') {
		return new TextEncoder().encode(decodeQuotedPrintable(trimmed))
	}
	return new TextEncoder().encode(bodyText)
}

/**
 * @param {Uint8Array} data
 * @returns {boolean}
 */
function hasPdfMagic(data) {
	return (
		data.length >= 4 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46
	)
}

/**
 * Payload is a single-line filesystem path ending in .pdf, not PDF bytes (common swaks mistake).
 *
 * @param {string} s
 * @returns {boolean}
 */
function looksLikeMistakenPathPdfPayload(s) {
	if (s.length < 6 || s.length > 8192 || /[\r\n\0]/.test(s)) return false
	const unix = /^\/.+\.pdf$/i.test(s) && !s.startsWith('//')
	const win = /^[a-zA-Z]:\\.*\.pdf$/i.test(s)
	return unix || win
}

/**
 * @param {string} fallbackName
 * @param {string} pathLine
 * @returns {{ filename: string, contentType: string, data: Uint8Array }}
 */
function mistakenPathPdfToHint(fallbackName, pathLine) {
	const segs = pathLine.split(/[/\\]/).filter(Boolean)
	const base = segs.length ? segs[segs.length - 1] : fallbackName
	const msg = `This is not a PDF — the attachment decodes to a path string, not file bytes:
${pathLine}

In swaks, --attach is handled like --body: a bare path is attached as that text. Prefix with @ to read the file:

  swaks --server 127.0.0.1 --port 2525 --to you@localhost \\
    --from tester@example.com \\
    --attach "@${pathLine}" --attach-type application/pdf \\
    --header "Subject: …"

Or: --attach - --attach-type application/pdf … </path/to/file.pdf
`
	return {
		filename: `${base.replace(/\.pdf$/i, '')}-how-to-attach.txt`,
		contentType: 'text/plain; charset=utf-8',
		data: new TextEncoder().encode(msg)
	}
}

/**
 * Swaks often uses application/octet-stream; still sniff %PDF. Path-as-payload → hint.
 *
 * @param {string} filename
 * @param {string} ctRaw
 * @param {Uint8Array} data
 * @returns {{ filename: string, contentType: string, data: Uint8Array }}
 */
function normalizeAttachmentForView(filename, ctRaw, data) {
	if (hasPdfMagic(data)) {
		let fn = filename
		if (!/\.pdf$/i.test(fn)) fn = `${fn}.pdf`
		return { filename: fn, contentType: 'application/pdf', data }
	}

	const asText = new TextDecoder('utf-8', { fatal: false }).decode(data).trim()
	if (looksLikeMistakenPathPdfPayload(asText)) {
		return mistakenPathPdfToHint(filename, asText)
	}

	const claimsPdf = /^application\/pdf\b/i.test(ctRaw)
	if (claimsPdf) {
		const bt = ctRaw.split(';')[0].trim().toLowerCase()
		return { filename, contentType: bt || 'application/octet-stream', data }
	}
	const baseType = ctRaw.split(';')[0].trim().toLowerCase() || 'application/octet-stream'
	return { filename, contentType: baseType, data }
}

/**
 * Root message header/body split (first entity only).
 *
 * @param {string} text
 * @returns {{ headerBlock: string, body: string } | null}
 */
function splitRootEntity(text) {
	let headerEnd = text.indexOf('\r\n\r\n')
	let skip = 4
	if (headerEnd === -1) {
		headerEnd = text.indexOf('\n\n')
		skip = 2
	}
	if (headerEnd === -1) return null
	return {
		headerBlock: text.slice(0, headerEnd),
		body: text.slice(headerEnd + skip)
	}
}

/**
 * Lists attachment filenames (flattened multipart, swaks-style MIME).
 *
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {string[]}
 */
export function listRfc822AttachmentFilenames(bytes) {
	const text = bytesToUtf8(bytes)
	const root = splitRootEntity(text)
	if (!root) return []

	const parts = flattenMimeParts(root.headerBlock, root.body)
	/** @type {string[]} */
	const names = []
	let anon = 0
	for (const part of parts) {
		if (!isLikelyAttachmentPart(part.headers)) continue
		let fn = attachmentFilenameFromPartHeaders(part.headers)
		if (!fn) {
			const ct = part.headers.get('content-type') ?? ''
			if (/^application\/pdf\b/i.test(ct)) fn = `attachment-${++anon}.pdf`
			else fn = `attachment-${++anon}`
		}
		names.push(fn)
	}
	return names
}

/**
 * Plain text body + decoded attachments for UI/API.
 *
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {{
 *   plainText: string
 *   attachments: Array<{
 *     filename: string
 *     contentType: string
 *     data: Uint8Array
 *     inlinePdf: boolean
 *   }>
 * }}
 */
export function parseRfc822ForView(bytes) {
	const text = bytesToUtf8(bytes)
	const root = splitRootEntity(text)
	if (!root) {
		return { plainText: '', attachments: [] }
	}

	const parts = flattenMimeParts(root.headerBlock, root.body)
	/** @type {string[]} */
	const textChunks = []
	/** @type {Array<{ filename: string, contentType: string, data: Uint8Array }>} */
	const attachments = []
	let anon = 0

	for (const part of parts) {
		const ctRaw = part.headers.get('content-type') ?? 'text/plain'
		const baseType = ctRaw.split(';')[0].trim().toLowerCase() || 'text/plain'
		if (!isLikelyAttachmentPart(part.headers)) {
			if (baseType === 'text/plain') {
				const raw = decodeMimePartBytes(part.headers, part.body)
				textChunks.push(new TextDecoder('utf-8', { fatal: false }).decode(raw))
			}
			continue
		}
		let fn = attachmentFilenameFromPartHeaders(part.headers)
		if (!fn) {
			if (/^application\/pdf\b/i.test(ctRaw)) fn = `attachment-${++anon}.pdf`
			else fn = `attachment-${++anon}`
		}
		const data = decodeMimePartBytes(part.headers, part.body)
		const normalized = normalizeAttachmentForView(fn, ctRaw, data)
		const inlinePdf =
			/^application\/pdf\b/i.test(normalized.contentType) && hasPdfMagic(normalized.data)
		attachments.push({
			filename: normalized.filename,
			contentType: normalized.contentType,
			data: normalized.data,
			inlinePdf
		})
	}

	return {
		plainText: textChunks.join('\n\n').trim() || '(no plain-text body)',
		attachments
	}
}

/**
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {{ subject: string, from: string, receivedAt: number }}
 */
export function parseRfc822Metadata(bytes) {
	const text = bytesToUtf8(bytes)
	let headerEnd = text.indexOf('\r\n\r\n')
	if (headerEnd === -1) headerEnd = text.indexOf('\n\n')
	const headerBlock = headerEnd === -1 ? text : text.slice(0, headerEnd)
	const headers = parseRfc822Headers(headerBlock)
	const subject = headers.get('subject') ?? '(no subject)'
	const from = headers.get('from') ?? '(unknown)'
	const dateHdr = headers.get('date')
	const receivedAt = dateHdr ? Date.parse(dateHdr) : Date.now()
	return {
		subject,
		from,
		receivedAt: Number.isNaN(receivedAt) ? Date.now() : receivedAt
	}
}
