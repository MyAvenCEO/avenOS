import { expect, test } from 'bun:test'
import { type EmailAttachment, emailImportContext } from '../src/lib/artifacts/email-import'

const attachment: EmailAttachment = {
	id: 'source-1-part-2',
	path: '/private/invoice.pdf',
	name: 'invoice.pdf',
	bytes: 10,
	subject: 'Your invoice',
	sender: 'supplier@example.test',
	part: '1.2',
	observedAt: '2026-09-01T00:00:00Z',
	source: {
		transport: 'imap',
		host: 'mail.example.test',
		user: 'reader@example.test',
		mailbox: 'INBOX',
		uid: '42',
		uidValidity: '100'
	}
}

test('email retries retain publication identity and provenance', async () => {
	const first = await emailImportContext('account-a', attachment, 'local')
	expect(await emailImportContext('account-a', attachment, 'local')).toEqual(first)
	expect(first.publicationId).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
	)
	expect(first.publicationId).not.toBe(first.intentId)
	expect(first.routingSummary).toContain('UID: 42; MIME part: 1.2')
	expect(first.observedAt).toBe(new Date(attachment.observedAt).toISOString())
})

test('account, attachment occurrence and execution placement have separate identities', async () => {
	const first = await emailImportContext('account-a', attachment, 'local')
	for (const other of [
		await emailImportContext('account-b', attachment, 'local'),
		await emailImportContext('account-a', { ...attachment, id: 'another-email' }, 'local'),
		await emailImportContext('account-a', attachment, 'server')
	]) {
		expect(other.intentId).not.toBe(first.intentId)
		expect(other.publicationId).not.toBe(first.publicationId)
	}
})
