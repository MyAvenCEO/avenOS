import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import {
	Actor,
	type ActorStepPayload,
	definitionFromManifest,
	type Manifest,
	resourceId,
	type TrustedActorInstallations
} from '@avenos/actors'
import { mailMessageSchema } from '@avenos/mail/artifact-types'
import { mailParserResultSchema } from '@avenos/mail/materialization'
import { compositionReader, implementationDigest, installedFactory } from './installed-runtime'
import type { StudioArtifacts } from './studio-artifacts'

const message = {
	name: 'message',
	role: 'message',
	cardinality: 'one' as const,
	schema: resourceId({
		authority: 'ceo.aven',
		kind: 'schema',
		namespace: 'mail',
		name: 'message',
		version: '1'
	}),
	predicate: 'ceo.aven.mail.message(MESSAGE)'
}
const manifest = {
	name: 'manifest',
	role: 'manifest',
	cardinality: 'one' as const,
	schema: resourceId({
		authority: 'ceo.aven',
		kind: 'schema',
		namespace: 'mail',
		name: 'message-parts',
		version: '1'
	}),
	predicate: 'ceo.aven.mail.message_parts(MANIFEST)'
}
const files = {
	name: 'files',
	role: 'files',
	cardinality: 'many' as const,
	schema: resourceId({
		authority: 'ceo.aven',
		kind: 'schema',
		namespace: 'docs',
		name: 'file',
		version: '1'
	}),
	predicate: 'ceo.aven.docs.file(F)'
}
export const MAIL_CONTENT_MANIFEST: Manifest = {
	id: 'message-parts',
	namespace: 'mail',
	authority: 'ceo.aven',
	version: '1',
	name: 'Read saved mail',
	tags: ['mail', 'files'],
	description:
		'Decode stored mail into readable text and supported attachments, preserving original mail and exact source ranges. No mailbox access.',
	methods: [
		{
			name: 'mail_materialize_parts',
			mode: 'transform',
			idempotency: 'pure',
			description:
				'Inspect up to 4 MiB of saved mail. Produces a parts manifest and zero or more text, JSON, CSV, PDF or image files. Unsupported or invalid parts, including HTML and nested messages, remain explicit in the manifest and original; no active content executes. Declared MIME types are not validation of file contents.',
			parameters: {
				type: 'object',
				properties: {},
				required: [],
				additionalProperties: false,
				maxProperties: 0
			},
			requires: [message.predicate],
			produces: [manifest.predicate],
			inputSlots: [message],
			outputSlots: [manifest, files]
		}
	]
}
export async function installMailContentActor(installations: TrustedActorInstallations) {
	await installations.install({
		packageId: '@avenos/actor-runner/mail-content',
		manifest: MAIL_CONTENT_MANIFEST,
		placements: ['server'],
		schemas: [message, manifest, files].map((p) => ({
			schema: p.schema,
			typeKey: p === files ? 'core.file' : p === message ? 'mail.message' : 'mail.message-parts',
			typeVersion: 1,
			projectorDigest: implementationDigest(p.schema)
		})),
		procedures: definitionFromManifest(MAIL_CONTENT_MANIFEST).capabilities.map((c) => ({
			capabilityId: c.id,
			procedureKey: 'mail.materialize',
			procedureVersion: '1',
			implementationDigest: implementationDigest('mail-parser-0.11.9-bounded-v1'),
			evidenceRuleDigest: implementationDigest('raw-mail-part-byte-ranges-1'),
			requiredFeatures: []
		}))
	})
}
export function parseSavedMail(
	bytes: Uint8Array,
	binary = process.env.MAIL_PARSER_BINARY ?? resolve('target/rust/debug/aven-mail-parser')
) {
	if (bytes.byteLength > 4194304) throw Error('MAIL_RAW_LIMIT')
	return new Promise<ReturnType<typeof mailParserResultSchema.parse>>((accept, reject) => {
		const child = execFile(
			binary,
			[],
			{
				env: {},
				timeout: 5000,
				killSignal: 'SIGKILL',
				maxBuffer: 12 * 1024 * 1024
			},
			(error, stdout) => {
				if (error) return reject(Error('MAIL_PARSER_UNAVAILABLE'))
				try {
					accept(mailParserResultSchema.parse(JSON.parse(stdout)))
				} catch {
					reject(Error('MAIL_PARSER_INVALID_RESULT'))
				}
			}
		)
		child.stdin!.on('error', () => {
			/* Process completion owns the error. */
		})
		child.stdin!.end(bytes)
	})
}
export function createMailContentFactory(store: StudioArtifacts) {
	return installedFactory(MAIL_CONTENT_MANIFEST, store.scope, () => {
		const actor = new Actor(MAIL_CONTENT_MANIFEST, {
			mail_materialize_parts: async (raw) => {
				const call = raw as ActorStepPayload,
					inputs = call.inputMembers?.message ?? []
				if (inputs.length !== 1) throw Error('MAIL_MESSAGE_REQUIRED')
				const source = await store.get(inputs[0]!.artifactId)
				if (source.typeKey !== 'mail.message' || source.typeVersion !== 1)
					throw Error('MAIL_MESSAGE_REQUIRED')
				const payload = mailMessageSchema.parse(source.payload)
				const bytes = await compositionReader(store).content(inputs[0]!, 4194304)
				if (
					bytes.byteLength !== payload.byteLength ||
					createHash('sha256').update(bytes).digest('hex') !== payload.sha256
				)
					throw Error('MAIL_MESSAGE_MISMATCH')
				const result = await parseSavedMail(bytes)
				const used = new Set<number>()
				for (const part of result.parts) {
					if (
						part.headerStart > part.bodyStart ||
						part.bodyStart > part.end ||
						part.end > bytes.length
					)
						throw Error('MAIL_PART_RANGE')
					if (part.fileIndex !== null) {
						if (
							used.has(part.fileIndex) ||
							!result.files[part.fileIndex] ||
							part.outcome !== 'materialized' ||
							part.bodyStart === part.end
						)
							throw Error('MAIL_PART_FILE')
						used.add(part.fileIndex)
					}
				}
				if (used.size !== result.files.length) throw Error('MAIL_PART_FILE')
				const blobs = Object.fromEntries(
					result.files.map((f, i) => {
						const content = Buffer.from(f.base64, 'base64')
						if (
							content.toString('base64') !== f.base64 ||
							content.length !== f.byteLength ||
							createHash('sha256').update(content).digest('hex') !== f.sha256
						)
							throw Error('MAIL_FILE_MISMATCH')
						return [`files-${i}`, { base64: f.base64, mediaType: f.mediaType }]
					})
				)
				const evidence = result.parts
					.filter((p) => p.fileIndex !== null)
					.map((p, ordinal) => ({
						ordinal,
						outputLocalKey: `files-${p.fileIndex}`,
						outputLocator: { kind: 'artifact-root' },
						inputRole: 'message',
						inputOrdinal: 0,
						inputLocator: {
							kind: 'byte-range',
							start: p.bodyStart,
							endExclusive: p.end
						}
					}))
				return {
					wire: `${result.files.length} files from saved mail; ${result.parts.filter((p) => p.outcome === 'unsupported').length} unsupported parts.`,
					record: JSON.stringify({
						ok: true,
						outputs: {
							manifest: {
								...result,
								files: result.files.map(({ base64, ...f }) => f)
							},
							files: result.files.map((f) => ({
								originalName: f.name,
								declaredMediaType: f.mediaType,
								sourceKind: 'mail-part',
								executionEnvironment: 'server'
							}))
						},
						blobs,
						evidence,
						references: {
							'manifest-0': [
								{ role: 'message', id: source.artifactId },
								...result.files.map((_, i) => ({
									role: 'file',
									local: `files-${i}`
								}))
							]
						}
					})
				}
			}
		})
		return { actor, dispose: () => actor.dispose() }
	})
}
