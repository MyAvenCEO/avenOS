/** Synthetic real-network management journey; not native UI or credential-use policy. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import {
	ConnectionManagement,
	type ConnectionTransport
} from '../../app/src/lib/connections/management'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { proveConnectionPolicies } from './connection-policy-proof'
import { credentialManagementFixture } from './credential-management-fixture'

const database = process.env.CREDENTIAL_TEST_DATABASE_URL,
	base = process.env.LIVE_LLM_BASE_URL
assert(database && base, 'Isolated PostgreSQL and real Qwen are required.')
const model = process.env.LIVE_LLM_MODEL ?? 'qwen3.8-flash-next'
assert(/qwen/i.test(model))
const directory = await mkdtemp('/tmp/aven-live-credential-management-')
console.log(directory)
const evidence = {
	synthetic: true,
	passed: false,
	scope:
		'Actual HTTP facade and encrypted ingress, signed identity, fresh SQL membership, restricted SQL roles, settings state controller and real Qwen metadata interpretation. Not native login/UI, deployment or use-policy proof.',
	checks: [] as string[],
	modelAnswers: [] as unknown[]
}
const fixture = await credentialManagementFixture(database)
try {
	let dropAcknowledgement = false,
		writeCount = 0
	const send: ConnectionTransport = async <T>(args: Parameters<ConnectionTransport>[0]) => {
		assert.equal(args.environmentId, fixture.environmentId)
		assert.equal(args.subjectId, fixture.subjectId)
		const suffix =
			args.action === 'metadata'
				? ''
				: args.action === 'receipt'
					? `/commands/${args.commandId}`
					: '/commands'
		const response = await fetch(
			`${fixture.baseUrl}/api/environments/${args.environmentId}/credentials${suffix}`,
			{
				method: args.action === 'command' ? 'POST' : 'GET',
				headers: {
					authorization: `Bearer ${fixture.token}`,
					origin: fixture.baseUrl,
					'content-type': 'application/json'
				},
				...(args.action === 'command' && {
					body: JSON.stringify({ commandId: args.commandId, command: args.command })
				})
			}
		)
		const body = (await response.json()) as Record<string, unknown>
		if (!response.ok)
			throw { message: 'Connection operation rejected.', code: body.code, status: response.status }
		if (args.action === 'command') {
			writeCount++
			if (dropAcknowledgement) {
				dropAcknowledgement = false
				throw Error('Synthetic acknowledgement loss after real commit')
			}
		}
		return body as T
	}
	const manager = new ConnectionManagement(fixture, send)
	const credentialRef = randomUUID(),
		bindingRef = randomUUID(),
		secret = randomUUID()
	dropAcknowledgement = true
	await assert.rejects(
		manager.command({
			action: 'create',
			credentialRef,
			expectedVersion: 0,
			label: 'Paper Orchard mailbox',
			kind: 'password',
			value: secret
		})
	)
	assert(manager.pendingCommand)
	await manager.checkReceipt()
	assert.equal(writeCount, 1)
	assert.equal((await manager.metadata()).credentials.length, 1)
	await manager.command({
		action: 'binding-set',
		credentialRef,
		bindingRef,
		expectedVersion: 0,
		protocol: 'imap',
		profile: {
			label: 'Paper Orchard project mail',
			host: 'mail.paper-orchard.example.test',
			port: 993,
			tls: 'implicit',
			authentication: 'password',
			login: 'project@example.test',
			accountRef: randomUUID(),
			mailboxes: ['Projects'],
			operations: ['query', 'read-message'],
			purpose: 'project-mail',
			maximumCommands: 24,
			maximumBytes: 1048576,
			maximumSeconds: 30
		}
	})
	const httpCredential = randomUUID(),
		httpBinding = randomUUID(),
		httpSecret = randomUUID()
	await manager.command({
		action: 'create',
		credentialRef: httpCredential,
		expectedVersion: 0,
		label: 'Paper Orchard reports',
		kind: 'token',
		value: httpSecret
	})
	await manager.command({
		action: 'binding-set',
		credentialRef: httpCredential,
		bindingRef: httpBinding,
		expectedVersion: 0,
		protocol: 'http',
		profile: {
			label: 'Orchard measurements',
			placements: ['server'],
			schemes: ['https'],
			host: { kind: 'exact', value: 'reports.paper-orchard.example.test' },
			ports: [443],
			pathPrefix: '/measurements',
			methods: ['GET', 'HEAD'],
			purpose: 'report-read',
			attachment: { kind: 'header', name: 'authorization', prefix: 'Bearer ' }
		}
	})
	evidence.checks.push(
		'create, typed IMAP/HTTP bindings and lost-acknowledgement reconciliation without a duplicate write'
	)
	const metadata = await manager.metadata()
	for (const value of [secret, httpSecret, 'ciphertext', 'encrypted_key'])
		assert(!JSON.stringify(metadata).includes(value))
	for (const headers of [
		{ origin: 'https://evil.example.test' },
		{ 'x-aven-work-grant': 'delegated' },
		{ cookie: 'untrusted=1' }
	]) {
		const denied = await fetch(
			`${fixture.baseUrl}/api/environments/${fixture.environmentId}/credentials`,
			{ headers: { authorization: `Bearer ${fixture.token}`, ...headers } }
		)
		assert.equal(denied.status, 403)
	}
	const other = await fetch(`${fixture.baseUrl}/api/environments/${randomUUID()}/credentials`, {
		headers: { authorization: `Bearer ${fixture.token}` }
	})
	assert.equal(other.status, 404)
	await fixture.root.query('DELETE FROM customer_environment_memberships WHERE environment_id=$1', [
		fixture.environmentId
	])
	await assert.rejects(manager.metadata())
	await fixture.root.query(
		"INSERT INTO customer_environment_memberships(environment_id,subject_id,role) VALUES($1,$2,'owner')",
		[fixture.environmentId, fixture.subjectId]
	)
	evidence.checks.push(
		'forbidden origin/delegation/cookies and other customer rejected; current membership reloaded'
	)
	const gateway = LlmGatewayService.fromConfig(
		testConfig({
			LLM_GATEWAY_ENABLED: 'true',
			LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
			LLM_GATEWAY_TIMEOUT_SECONDS: '180',
			LLM_GATEWAY_MODELS_JSON: JSON.stringify([
				{
					id: 'proof',
					label: 'Actual Qwen',
					baseUrl: base,
					upstreamModel: model,
					profile: 'qwen-tools',
					authMode: 'none',
					capabilities: ['text-generation', 'structured-output']
				}
			])
		})
	)!
	for (const [question, selected, canRead, canWrite] of [
		[
			'Welcher Zugang passt zu den Projekt-Mails? Darf der Agent damit sofort Mails lesen oder löschen?',
			bindingRef,
			false,
			false
		],
		[
			'Which saved connection is suitable for reading orchard measurements? Does a stored binding itself approve an API request or allow POST?',
			httpBinding,
			false,
			false
		]
	] as const) {
		const response = await gateway.complete({
			modelId: 'proof',
			instructions:
				'Interpret saved connection metadata. Setting up a binding is not approval to use it. No review decision has been supplied. Return the suitable bindingRef and whether use is authorized now and whether remote modification is supported. Never invent a secret.',
			messages: [
				{
					role: 'user',
					content: [{ type: 'text', text: `${question}\n${JSON.stringify(metadata)}` }]
				}
			],
			maxOutputTokens: 4096,
			output: {
				format: 'json',
				name: 'connection_choice',
				schema: {
					type: 'object',
					properties: {
						bindingRef: { type: 'string' },
						useAuthorizedNow: { type: 'boolean' },
						modificationSupported: { type: 'boolean' }
					},
					required: ['bindingRef', 'useAuthorizedNow', 'modificationSupported'],
					additionalProperties: false
				}
			}
		})
		assert.equal(response.output.format, 'json')
		if (response.output.format !== 'json') throw Error('Expected structured output')
		assert.deepEqual(response.output.value, {
			bindingRef: selected,
			useAuthorizedNow: canRead,
			modificationSupported: canWrite
		})
		evidence.modelAnswers.push(response.output.value)
	}
	evidence.checks.push(
		await proveConnectionPolicies(fixture, { http: httpBinding, imap: bindingRef })
	)
	await manager.command({
		action: 'rotate',
		credentialRef,
		expectedVersion: 1,
		value: randomUUID()
	})
	await manager.command({ action: 'revoke', credentialRef, expectedVersion: 2 })
	const final = await manager.metadata()
	assert.equal(final.credentials.find((c) => c.credentialRef === credentialRef)?.enabled, false)
	assert.equal(final.credentials.find((c) => c.credentialRef === httpCredential)?.enabled, true)
	manager.close()
	await assert.rejects(manager.metadata())
	evidence.checks.push(
		'rotation and revocation retained; unrelated connection intact; closed form cannot issue further requests'
	)
	evidence.passed = true
	console.log(
		'PASS encrypted credential management through authenticated facade and real Qwen metadata checks'
	)
} finally {
	await writeFile(`${directory}/evidence.json`, JSON.stringify(evidence, null, 2))
	await fixture.close()
}
