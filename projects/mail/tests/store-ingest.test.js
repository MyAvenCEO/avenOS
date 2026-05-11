import { describe, expect, test } from 'bun:test'
import {
	createInMemoryMailStore,
	ingestRfc822,
	listMessageSummaries,
	listRfc822AttachmentFilenames,
	parseRfc822ForView,
	parseRfc822Metadata
} from '../src/index.js'

/** Minimal one-page PDF (base64). */
const tinyPdfB64 =
	'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94W0AgMCAzIDNdPj4KZW5kb2JqCnhyZWYKMCAKdHJhaWxlcgo8PC9TaXplIDQ+PgolJUVPRgo='

describe('parseRfc822Metadata', () => {
	test('parses subject from and date', () => {
		const raw =
			'Subject: Hello\r\nFrom: "A" <a@b.com>\r\nDate: Wed, 1 Jan 2020 12:00:00 +0000\r\n\r\nbody'
		const m = parseRfc822Metadata(new TextEncoder().encode(raw))
		expect(m.subject).toBe('Hello')
		expect(m.from).toBe('"A" <a@b.com>')
		expect(m.receivedAt).toBe(Date.parse('Wed, 1 Jan 2020 12:00:00 +0000'))
	})
})

describe('parseRfc822ForView', () => {
	test('non-multipart message exposes plain body', () => {
		const raw = 'Subject: Hi\r\nFrom: a@b.c\r\n\r\nHello world'
		const v = parseRfc822ForView(new TextEncoder().encode(raw))
		expect(v.plainText).toContain('Hello world')
		expect(v.attachments.length).toBe(0)
	})

	test('multipart mixed keeps first text/plain part in plainText', () => {
		const raw = [
			'Subject: Doc',
			'From: a@b.c',
			'Date: Wed, 1 Jan 2025 00:00:00 +0000',
			'MIME-Version: 1.0',
			'Content-Type: multipart/mixed; boundary="mimeb"',
			'',
			'--mimeb',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'See attached',
			'--mimeb',
			'Content-Type: application/pdf; name="report.pdf"',
			'Content-Disposition: attachment; filename="report.pdf"',
			'Content-Transfer-Encoding: base64',
			'',
			tinyPdfB64,
			'--mimeb--',
			''
		].join('\r\n')
		const v = parseRfc822ForView(new TextEncoder().encode(raw))
		expect(v.plainText).toContain('See attached')
		expect(v.attachments.length).toBe(1)
		expect(v.attachments[0].inlinePdf).toBe(true)
		expect(v.attachments[0].filename).toBe('report.pdf')
	})

	test('application/pdf with path string payload becomes text hint, not inlinePdf', () => {
		const pathLine = '/tmp/example-doc.pdf'
		const b64 = Buffer.from(pathLine, 'utf8').toString('base64')
		const raw = [
			'Subject: Bad attach',
			'From: a@b.c',
			'Date: Wed, 1 Jan 2025 00:00:00 +0000',
			'MIME-Version: 1.0',
			'Content-Type: multipart/mixed; boundary="b"',
			'',
			'--b',
			'Content-Type: text/plain',
			'',
			'Body',
			'--b',
			'Content-Type: application/pdf',
			'Content-Disposition: attachment',
			'Content-Transfer-Encoding: BASE64',
			'',
			b64,
			'--b--'
		].join('\r\n')
		const v = parseRfc822ForView(new TextEncoder().encode(raw))
		expect(v.plainText).toContain('Body')
		expect(v.attachments.length).toBe(1)
		expect(v.attachments[0].inlinePdf).toBe(false)
		expect(v.attachments[0].contentType).toContain('text/plain')
		expect(v.attachments[0].filename).toBe('example-doc-how-to-attach.txt')
		expect(new TextDecoder().decode(v.attachments[0].data)).toContain('--attach "@')
	})

	test('application/octet-stream with path string (swaks-style) becomes text hint', () => {
		const pathLine = '/Users/x/Desktop/doc.pdf'
		const b64 = Buffer.from(pathLine, 'utf8').toString('base64')
		const raw = [
			'Subject: swaks octet',
			'From: a@b.c',
			'Date: Wed, 1 Jan 2025 00:00:00 +0000',
			'MIME-Version: 1.0',
			'Content-Type: multipart/mixed; boundary="b"',
			'',
			'--b',
			'Content-Type: text/plain',
			'',
			'hi',
			'--b',
			'Content-Type: application/octet-stream',
			'Content-Disposition: attachment',
			'Content-Transfer-Encoding: base64',
			'',
			b64,
			'--b--'
		].join('\r\n')
		const v = parseRfc822ForView(new TextEncoder().encode(raw))
		expect(v.attachments[0].contentType).toContain('text/plain')
		expect(v.attachments[0].filename).toBe('doc-how-to-attach.txt')
	})

	test('application/octet-stream with PDF magic is normalized to application/pdf', () => {
		const raw = [
			'Subject: octet pdf',
			'From: a@b.c',
			'Date: Wed, 1 Jan 2025 00:00:00 +0000',
			'MIME-Version: 1.0',
			'Content-Type: multipart/mixed; boundary="b"',
			'',
			'--b',
			'Content-Type: text/plain',
			'',
			'hi',
			'--b',
			'Content-Type: application/octet-stream',
			'Content-Disposition: attachment',
			'Content-Transfer-Encoding: base64',
			'',
			tinyPdfB64,
			'--b--'
		].join('\r\n')
		const v = parseRfc822ForView(new TextEncoder().encode(raw))
		expect(v.attachments[0].contentType).toContain('application/pdf')
		expect(v.attachments[0].filename).toBe('attachment-1.pdf')
		expect(v.attachments[0].inlinePdf).toBe(true)
	})
})

describe('listRfc822AttachmentFilenames', () => {
	test('collects PDF filename from multipart attachment', () => {
		const raw = [
			'Subject: Doc',
			'From: a@b.c',
			'Date: Wed, 1 Jan 2025 00:00:00 +0000',
			'MIME-Version: 1.0',
			'Content-Type: multipart/mixed; boundary="mimeb"',
			'',
			'--mimeb',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'See attached',
			'--mimeb',
			'Content-Type: application/pdf; name="report.pdf"',
			'Content-Disposition: attachment; filename="report.pdf"',
			'Content-Transfer-Encoding: base64',
			'',
			tinyPdfB64,
			'--mimeb--',
			''
		].join('\r\n')
		const names = listRfc822AttachmentFilenames(new TextEncoder().encode(raw))
		expect(names).toEqual(['report.pdf'])
	})
})

describe('ingest + list', () => {
	test('ingest adds row and listMessageSummaries sorts newest first', () => {
		const store = createInMemoryMailStore()
		const a = 'Subject: Old\r\nFrom: x@y.z\r\nDate: Mon, 1 Jan 2024 00:00:00 +0000\r\n\r\na'
		const b = 'Subject: New\r\nFrom: x@y.z\r\nDate: Tue, 2 Jan 2024 00:00:00 +0000\r\n\r\nb'
		ingestRfc822(store, new TextEncoder().encode(a))
		ingestRfc822(store, new TextEncoder().encode(b))
		const list = listMessageSummaries(store)
		expect(list.length).toBe(2)
		expect(list[0].subject).toBe('New')
		expect(list[1].subject).toBe('Old')
		expect(list[0].attachments).toEqual([])
		expect(list[1].attachments).toEqual([])
	})

	test('ingest stores attachment filenames for multipart PDF', () => {
		const store = createInMemoryMailStore()
		const raw = [
			'Subject: Attached',
			'From: x@y.z',
			'Date: Wed, 1 Jan 2025 00:00:00 +0000',
			'MIME-Version: 1.0',
			'Content-Type: multipart/mixed; boundary="x"',
			'',
			'--x',
			'Content-Type: text/plain',
			'',
			'hi',
			'--x',
			'Content-Type: application/pdf',
			'Content-Disposition: attachment; filename="doc.pdf"',
			'Content-Transfer-Encoding: base64',
			'',
			tinyPdfB64,
			'--x--'
		].join('\r\n')
		ingestRfc822(store, new TextEncoder().encode(raw))
		const list = listMessageSummaries(store)
		expect(list[0].attachments).toEqual(['doc.pdf'])
	})
})
