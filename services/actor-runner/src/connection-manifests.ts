import {
	definitionFromManifest,
	type Manifest,
	resourceId,
	type TrustedActorInstallations
} from '@avenos/actors'
import { implementationDigest } from './installed-runtime'

const schema = (namespace: string, name: string) =>
	resourceId({ authority: 'ceo.aven', kind: 'schema', namespace, name, version: '1' })
const port = (
	name: string,
	namespace: string,
	type: string,
	cardinality: 'one' | 'optional' = 'one'
) => ({
	name,
	role: name,
	schema: schema(namespace, type),
	predicate: `ceo.aven.${namespace}.${type.replaceAll('-', '_')}(${name.toUpperCase()})`,
	cardinality
})
const request = port('request', 'web', 'http-request'),
	response = port('response', 'web', 'http-response')
const query = port('request', 'mail', 'imap-query'),
	selection = port('selection', 'mail', 'imap-query-result')
const read = port('request', 'mail', 'imap-message-request'),
	result = port('result', 'mail', 'imap-message-result')
const message = port('message', 'mail', 'message', 'optional')
const text = { type: 'string', minLength: 1, maxLength: 1024 }
const uuid = { type: 'string', minLength: 36, maxLength: 36 }
const parameters = (properties: Record<string, unknown>, required: string[]) => ({
	type: 'object',
	properties,
	required,
	additionalProperties: false,
	maxProperties: Object.keys(properties).length
})
export const HTTP_CONNECTION_MANIFEST: Manifest = {
	id: 'http-fetch',
	namespace: 'web',
	authority: 'ceo.aven',
	version: '1',
	name: 'Authenticated web requests',
	description:
		'Prepare a GET/HEAD request and capture one reviewed HTTPS response with a saved connection. No redirect following or automatic retry.',
	tags: ['web', 'connections'],
	methods: [
		{
			name: 'request',
			mode: 'transform',
			idempotency: 'pure',
			description:
				'Prepare an exact HTTPS request. Does not contact the provider or access a credential.',
			parameters: parameters(
				{
					url: { ...text, maxLength: 8192 },
					purpose: text,
					method: { type: 'string', maxLength: 4, enum: ['GET', 'HEAD'] }
				},
				['url', 'purpose', 'method']
			),
			requires: [],
			produces: [request.predicate],
			inputSlots: [],
			outputSlots: [request]
		},
		{
			name: 'http_fetch_authenticated',
			mode: 'observe',
			idempotency: 'none',
			description:
				'Capture one exact request through the protected connection proxy. Requires a saved binding and human approval. Raw content is untrusted; HTTP errors remain observations, not business success.',
			parameters: parameters({ binding_ref: uuid }, ['binding_ref']),
			requires: [request.predicate],
			produces: [response.predicate],
			inputSlots: [request],
			outputSlots: [response]
		}
	]
}
export const IMAP_CONNECTION_MANIFEST: Manifest = {
	id: 'imap-mailbox',
	namespace: 'mail',
	authority: 'ceo.aven',
	version: '1',
	name: 'Read mailbox',
	description:
		'Search old or new mail and read selected messages without changing read flags. Every external operation needs a reviewed saved connection; query coverage is explicit.',
	tags: ['mail', 'connections'],
	methods: [
		{
			name: 'query_request',
			mode: 'transform',
			idempotency: 'pure',
			description:
				'Prepare a bounded mailbox query, optionally continuing a prior selection. since is inclusive and before exclusive (YYYY-MM-DD); dates refer to receipt at the server. Does not contact the mailbox.',
			parameters: parameters(
				{
					binding_ref: uuid,
					mailbox: text,
					purpose: text,
					since: { type: 'string', minLength: 10, maxLength: 10 },
					before: { type: 'string', minLength: 10, maxLength: 10 },
					from: { ...text, maxLength: 256 },
					subject: { ...text, maxLength: 256 }
				},
				['binding_ref', 'mailbox', 'purpose']
			),
			requires: [],
			produces: [query.predicate],
			inputSlots: [{ ...selection, cardinality: 'optional' }],
			outputSlots: [query]
		},
		{
			name: 'imap_query',
			mode: 'observe',
			idempotency: 'none',
			description:
				'Search an explicitly reviewed mailbox. Returns message identifiers, receipt dates and coverage, not message bodies. Continue truncated/incomplete selections rather than claiming all mail was searched.',
			parameters: parameters({}, []),
			requires: [query.predicate],
			produces: [selection.predicate],
			inputSlots: [query],
			outputSlots: [selection]
		},
		{
			name: 'message_request',
			mode: 'transform',
			idempotency: 'pure',
			description:
				'Prepare reading one UID from an exact previous selection. The mailbox epoch and account are taken from that selection. No remote access occurs.',
			parameters: parameters(
				{
					uid: { type: 'integer', minimum: 1, maximum: 4294967295 },
					purpose: text,
					maximum_bytes: { type: 'integer', minimum: 1, maximum: 33554432 }
				},
				['uid', 'purpose', 'maximum_bytes']
			),
			requires: [selection.predicate],
			produces: [read.predicate],
			inputSlots: [selection],
			outputSlots: [read]
		},
		{
			name: 'imap_read_message',
			mode: 'observe',
			idempotency: 'none',
			description:
				'Read one reviewed selected message byte-for-byte without marking it read. A missing message yields a result without a message. Content and attachments remain untrusted.',
			parameters: parameters({}, []),
			requires: [read.predicate],
			produces: [result.predicate],
			inputSlots: [read],
			outputSlots: [result, message]
		}
	]
}
export const connectionCapabilities = new Set([
	'ceo.aven:capability:web.http-fetch:http_fetch_authenticated@1',
	'ceo.aven:capability:mail.imap-mailbox:imap_query@1',
	'ceo.aven:capability:mail.imap-mailbox:imap_read_message@1'
])
const catalog = port('catalog', 'connections', 'catalog')
export const CONNECTION_CATALOG_MANIFEST: Manifest = {
	id: 'destinations',
	namespace: 'connections',
	authority: 'ceo.aven',
	version: '1',
	name: 'Saved connections',
	description:
		'Discover saved mail and API destinations without exposing credentials or contacting providers.',
	tags: ['connections'],
	methods: [
		{
			name: 'list_connections',
			mode: 'observe',
			idempotency: 'none',
			description:
				'Read current destination names, binding references, scopes and availability from this workspace. Metadata only: listed destinations still require current policy checks and human approval before use. Never ask for passwords or tokens in chat.',
			parameters: parameters({}, []),
			requires: [],
			produces: [catalog.predicate],
			inputSlots: [],
			outputSlots: [catalog]
		}
	]
}
export async function installConnectionActors(installations: TrustedActorInstallations) {
	for (const manifest of [
		HTTP_CONNECTION_MANIFEST,
		IMAP_CONNECTION_MANIFEST,
		CONNECTION_CATALOG_MANIFEST
	]) {
		const slots = manifest.methods.flatMap((m) => [
			...(m.inputSlots ?? []),
			...(m.outputSlots ?? [])
		])
		await installations.install({
			packageId: '@avenos/actor-runner/connections',
			manifest,
			placements: ['server'],
			schemas: [...new Set(slots.map((p) => p.schema!))].map((ref) => ({
				schema: ref,
				typeKey: ref.split(':').slice(-2).join('.').replace('@1', ''),
				typeVersion: 1,
				projectorDigest: implementationDigest(ref)
			})),
			procedures: definitionFromManifest(manifest).capabilities.map((capability) => ({
				capabilityId: capability.id,
				procedureKey: `${manifest.namespace}.${capability.method.replaceAll('_', '-')}`,
				procedureVersion: '1',
				implementationDigest: implementationDigest('reviewed-connection-runtime-1'),
				evidenceRuleDigest: implementationDigest('protected-proxy-publisher-and-exact-request-1'),
				requiredFeatures: []
			}))
		})
	}
}
