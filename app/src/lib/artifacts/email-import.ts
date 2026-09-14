import type { ExecutionEnvironment } from '@avenos/actors'

export interface EmailAttachment {
	id: string
	path: string
	name: string
	bytes: number
	subject: string
	sender: string
	part: string
	observedAt: string
	source: {
		transport: string
		host?: string
		user?: string
		mailbox?: string
		uid?: string
		uidValidity?: string
	}
}

export interface FileImportContext {
	background?: boolean
	throwOnError?: boolean
	imapScope: string
	publicationId: string
	intentId: string
	observedAt: string
	sourceLabel: string
	routingSummary: string
}

async function stableId(value: string): Promise<string> {
	// RFC UUID v5 in the DNS namespace. Artifact Store accepts UUID versions 1–5.
	const namespace = Uint8Array.from('6ba7b8109dad11d180b400c04fd430c8'.match(/../g) ?? [], (hex) =>
		Number.parseInt(hex, 16)
	)
	const name = new TextEncoder().encode(`avenos.email-import:${value}`)
	const input = new Uint8Array(namespace.length + name.length)
	input.set(namespace)
	input.set(name, namespace.length)
	const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', input))
	hash[6] = (hash[6] & 0x0f) | 0x50
	hash[8] = (hash[8] & 0x3f) | 0x80
	const hex = Array.from(hash.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function emailImportContext(
	scope: string,
	attachment: EmailAttachment,
	environment: ExecutionEnvironment
): Promise<FileImportContext> {
	const key = JSON.stringify(['imap-import-v1', scope, attachment.id, environment])
	const [publicationId, intentId] = await Promise.all([
		stableId(`${key}:publication`),
		stableId(`${key}:intent`)
	])
	const source = attachment.source
	return {
		imapScope: scope,
		publicationId,
		intentId,
		observedAt: new Date(attachment.observedAt).toISOString(),
		sourceLabel:
			source.transport === 'imap' ? 'IMAP · Email attachment' : 'Email · Demo attachment',
		routingSummary:
			`Email attachment: ${attachment.name}\nUIDVALIDITY: ${source.uidValidity ?? 'n/a'}; UID: ${source.uid ?? 'n/a'}; MIME part: ${attachment.part}\nMailbox: ${source.user ?? 'demo'} / ${source.mailbox ?? 'sample'}\nFrom: ${attachment.sender}\nSubject: ${attachment.subject}`.slice(
				0,
				1024
			)
	}
}
