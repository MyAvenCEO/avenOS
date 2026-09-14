import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TenantGrantClaims } from '@avenos/aven-customer-contracts'
import type { IdentityClaims } from '@avenos/aven-identity'
import { ArtifactHandler } from '../../services/aven-api/src/artifacts/handler'
import type { ArtifactFileService } from '../../services/aven-api/src/lib/server/artifacts/service'
import { type EmailAttachment, emailImportContext } from '../src/lib/artifacts/email-import'

test('native Python samples pass the real artifact HTTP validator for both placements', async () => {
	const output = mkdtempSync(join(tmpdir(), 'email-boundary-'))
	try {
		const result = spawnSync(
			'python3',
			[
				'-I',
				new URL('../../prototypes/imap-pdf/imap_pdf.py', import.meta.url).pathname,
				'--tauri',
				output
			],
			{
				input: JSON.stringify({ operation: 'demo' }),
				encoding: 'utf8'
			}
		)
		expect(result.status).toBe(0)
		const attachments: EmailAttachment[] = JSON.parse(result.stdout).result.attachments
		const declaration = JSON.parse(
			readFileSync(
				new URL(
					'../../services/artifact-store/conformance/fixtures/protocol/intent.declaration.v1.json',
					import.meta.url
				),
				'utf8'
			)
		)
		const allowedIntentId = new RegExp(declaration.payloadSchema.properties.intentId.pattern)
		let publications = 0
		// Only storage is substituted. Header validation and response handling are production code.
		const handler = new ArtifactHandler({
			publishFile: async (input: { body: ReadableStream; observedAt: string }) => {
				const bytes = await new Response(input.body).text()
				expect(bytes.startsWith('%PDF-')).toBe(true)
				expect(input.observedAt.endsWith('Z')).toBe(true)
				publications++
				return { accepted: true }
			}
		} as unknown as ArtifactFileService)
		for (const environment of ['local', 'server'] as const) {
			for (const attachment of attachments) {
				const context = await emailImportContext('account', attachment, environment)
				expect(allowedIntentId.test(context.intentId)).toBe(true)
				const body = readFileSync(attachment.path)
				const send = (observedAt: string) =>
					handler.user(
						new Request(`http://api.test/api/artifacts/files/${context.publicationId}`, {
							method: 'PUT',
							body,
							headers: {
								'content-type': 'application/pdf',
								'content-length': String(body.length),
								'x-aven-intent-id': context.intentId,
								'x-aven-observed-at': observedAt,
								'x-aven-original-name': Buffer.from(attachment.name).toString('base64url'),
								'x-expected-sha256': '0'.repeat(64),
								'x-aven-execution-environment': environment
							}
						}),
						{ sub: 'user' } as IdentityClaims,
						{ databaseName: 'cust_test', environmentId: 'scope' } as TenantGrantClaims,
						`files/${context.publicationId}`
					)
				const broken = await send(attachment.observedAt)
				expect(broken.status).toBe(400)
				expect((await broken.json()).code).toBe('ARTIFACT_REQUEST_INVALID')
				const accepted = await send(context.observedAt)
				expect(accepted.status).toBe(201)
			}
		}
		expect(publications).toBe(4)
	} finally {
		rmSync(output, { recursive: true, force: true })
	}
})
