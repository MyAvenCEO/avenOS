/** Encoding-to-transport proof, not a deployed Vault or durable use-claim proof. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose'
import { ChatCore } from '../../libs/aven-chat-engine/src/chat'
import {
	chatGatewayRequest,
	createGatewayModelStream
} from '../../libs/aven-chat-engine/src/gateway'
import {
	CredentialStorageError,
	type SecretContext
} from '../../libs/aven-credential-storage/src/envelope'
import {
	loadCredentialSealer,
	loadCredentialUnsealer
} from '../../libs/aven-credential-storage/src/keys'
import {
	httpRequestDigest,
	parseHttpRequestArtifact
} from '../../libs/aven-http-resources/src/contracts'
import { PinnedHttpResourceTransport } from '../../libs/aven-http-resources/src/transport'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'

const base = process.env.LIVE_LLM_BASE_URL
assert(base, 'Configure real Qwen; no substitute model is available.')
const model = process.env.LIVE_LLM_MODEL ?? 'qwen3.8-flash-next'
assert(/qwen/i.test(model))
const out = await mkdtemp('/tmp/aven-live-credential-envelope-')
const secret = randomUUID()
const context: SecretContext = {
	environmentId: randomUUID(),
	ownerSubjectId: randomUUID(),
	credentialRef: randomUUID(),
	kind: 'token',
	secretVersion: 1
}
const keyDirectory = await mkdtemp('/tmp/aven-private-synthetic-envelope-keys-')
try {
	// Offline test provisioning; services load nonextractable runtime keys from their
	// separately mounted public/private files, never from model inputs.
	async function provision(name: string) {
		const pair = await generateKeyPair('RSA-OAEP-256', { modulusLength: 3072, extractable: true })
		await writeFile(
			`${keyDirectory}/${name}.public.json`,
			JSON.stringify({
				format: 'aven-credential-sealing-key-v1',
				keyId: name,
				publicKey: await exportSPKI(pair.publicKey)
			}),
			{ mode: 0o644 }
		)
		await writeFile(
			`${keyDirectory}/${name}.private.json`,
			JSON.stringify({
				format: 'aven-credential-unsealing-keys-v1',
				keys: [{ keyId: name, privateKey: await exportPKCS8(pair.privateKey) }]
			}),
			{ mode: 0o600 }
		)
	}
	await provision('first')
	await provision('next')
	const envelope = await (await loadCredentialSealer(`${keyDirectory}/first.public.json`)).seal(
		new TextEncoder().encode(secret),
		context
	)
	await writeFile(`${out}/encrypted-record.json`, JSON.stringify(envelope), { mode: 0o600 })
	const stored = JSON.parse(await readFile(`${out}/encrypted-record.json`, 'utf8'))
	await copyFile(`${keyDirectory}/first.private.json`, `${keyDirectory}/escrow.private.json`)
	await unlink(`${keyDirectory}/first.private.json`)
	await assert.rejects(
		loadCredentialUnsealer(`${keyDirectory}/first.private.json`),
		/CREDENTIAL_KEY_FILE_UNAVAILABLE/
	)
	await copyFile(`${keyDirectory}/escrow.private.json`, `${keyDirectory}/first.private.json`)
	const restored = await loadCredentialUnsealer(`${keyDirectory}/first.private.json`)
	const plaintext = await restored.unseal(stored, context)
	const rewrapped = await (await loadCredentialSealer(`${keyDirectory}/next.public.json`)).seal(
		plaintext,
		context
	)
	plaintext.fill(0)
	const current = await loadCredentialUnsealer(`${keyDirectory}/next.private.json`)
	const evidence = {
		synthetic: true,
		passed: false,
		model,
		startedAt: new Date().toISOString(),
		scope:
			'Real Qwen and ChatCore over encrypted JSON storage, actual JWE, separate operator key-file loading, synthetic key-file loss/restore and fixed-origin authenticated HTTP. Test host port; not SQL Vault, isolated executor process, durable claims, external escrow recovery, IMAP, native or Studio qualification.',
		fingerprints: {} as Record<string, string>,
		cases: [] as Array<Record<string, unknown>>,
		error: ''
	}
	for (const path of [
		'deploy/e2e/live-credential-envelope.ts',
		'libs/aven-credential-storage/src/envelope.ts',
		'libs/aven-credential-storage/src/keys.ts',
		'libs/aven-chat-engine/src/chat.ts',
		'libs/aven-chat-engine/src/research.ts',
		'libs/aven-http-resources/src/transport.ts'
	])
		evidence.fingerprints[path] = createHash('sha256')
			.update(await readFile(path))
			.digest('hex')
	const save = () => writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2))
	console.log(out)
	const gateway = LlmGatewayService.fromConfig(
		testConfig({
			LLM_GATEWAY_ENABLED: 'true',
			LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
			LLM_GATEWAY_TIMEOUT_SECONDS: '180',
			LLM_GATEWAY_MODELS_JSON: JSON.stringify([
				{
					id: 'proof',
					label: 'Credential envelope proof',
					baseUrl: base,
					upstreamModel: model,
					profile: 'qwen-tools',
					authMode: 'none',
					capabilities: ['text-generation', 'streaming', 'tool-calling', 'structured-output']
				}
			])
		})
	)
	assert(gateway, 'The live gateway must be configured')
	const stream = createGatewayModelStream({
		request: (input) => {
			assert(!JSON.stringify(input).includes(secret), 'Secret must not enter any model request')
			assert(
				!JSON.stringify(input).includes(envelope.jwe.ciphertext),
				'Ciphertext is not model evidence'
			)
			return chatGatewayRequest({ ...input, model: 'proof' }, 16384)
		},
		open: async function* (request, signal) {
			const response = await gateway.openAiChatCompletion(request, signal)
			assert(response.ok && response.body)
			const decoder = new TextDecoder()
			for await (const bytes of response.body) yield decoder.decode(bytes, { stream: true })
			yield decoder.decode()
		}
	})
	let hits = 0,
		rejected = 0
	const server = createServer((request, response) => {
		if (request.headers.authorization !== `Bearer ${secret}` || request.url !== '/supplies') {
			rejected++
			response.writeHead(403).end()
			return
		}
		hits++
		response.setHeader('content-type', 'application/json')
		response.end(JSON.stringify({ item: 'felt pouches', count: 17, unit: 'pieces' }))
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	try {
		const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
		const request = parseHttpRequestArtifact(
			{
				method: 'GET',
				url: `${origin}/supplies`,
				authentication: { mode: 'mapped-required', purpose: 'supplies-read' },
				freshness: 'new-capture'
			},
			{ allowHttpOrigins: [origin] }
		)
		const transport = new PinnedHttpResourceTransport({
			allowedOrigins: [],
			localTestOrigins: [origin],
			maximumBodyBytes: 1024
		})
		const specs = [
			{
				name: 'supplies_read',
				answerReview: 'required' as const,
				description:
					'Read the current supplies count through the configured host connection. The host alone handles credentials. No parameters, secret values, permission changes or alternative destinations are available. On a blocked acquisition, stop and report that the count is unknown, not zero; do not retry.',
				parameters: { type: 'object', properties: {}, additionalProperties: false }
			}
		]
		for (const scenario of [
			{
				name: 'restored record',
				expectedHits: 1,
				unsealer: restored,
				value: stored,
				expected: context,
				question: 'Read the supplies: how many felt pouches are available? Keep it brief.'
			},
			{
				name: 'cross-environment substitution blocked',
				expectedHits: 0,
				unsealer: restored,
				value: stored,
				expected: { ...context, environmentId: randomUUID() },
				question:
					'Lies die Vorräte. Wie viele Filzbeutel sind verfügbar? Wenn der Abruf scheitert, nenne keinen erfundenen Bestand.'
			},
			{
				name: 'removed key blocks release',
				expectedHits: 0,
				unsealer: current,
				value: stored,
				expected: context,
				question:
					'Leggi le scorte: quanti sacchetti di feltro sono disponibili? Se non puoi leggere il dato, dillo senza inventare un numero.'
			},
			{
				name: 'rewrapped record works with new key only',
				expectedHits: 1,
				unsealer: current,
				value: rewrapped,
				expected: context,
				question: 'Consulta las existencias. ¿Cuántas bolsas de fieltro hay? Responde brevemente.'
			}
		]) {
			const before = hits,
				outcomes: unknown[] = []
			const chat = new ChatCore(
				{},
				{
					specs,
					run: async (name, args) => {
						assert.equal(name, 'supplies_read')
						assert.deepEqual(JSON.parse(args), {})
						assert.equal(
							outcomes.length,
							0,
							'One bounded acquisition, no retry after key/context failure'
						)
						let bytes: Uint8Array | undefined
						let value: unknown
						try {
							bytes = await scenario.unsealer.unseal(scenario.value, scenario.expected)
							const response = await transport.exchange({
								request,
								credential: {
									bindingRef: randomUUID(),
									bindingRevision: 1,
									credentialRef: context.credentialRef,
									secretVersion: context.secretVersion,
									requestDigest: httpRequestDigest(request),
									rule: { kind: 'header', name: 'authorization', prefix: 'Bearer ' },
									secret: new TextDecoder().decode(bytes)
								}
							})
							assert.equal(response.status, 200)
							value = { ok: true, observation: await new Response(response.body).json() }
						} catch (error) {
							if (!(error instanceof CredentialStorageError)) throw error
							value = {
								ok: false,
								code: error.code,
								providerContacted: false,
								bodyReleased: false,
								meaning:
									'The host could not release the configured credential for this read. No request reached the provider. The requested inventory value remains unknown, not zero or absent. This tool cannot repair the connection.'
							}
						} finally {
							bytes?.fill(0)
						}
						outcomes.push(value)
						const record = JSON.stringify(value)
						return { record, wire: record }
					}
				},
				stream
			)
			chat.use(randomUUID())
			const started = performance.now()
			try {
				await chat.send(scenario.question)
				const reply = chat.turns.at(-1)
				assert(reply, 'The live turn must produce a reply')
				const row = {
					name: scenario.name,
					question: scenario.question,
					reply,
					outcomes,
					providerRequests: hits - before,
					diagnostics: chat.diagnostics,
					durationMs: performance.now() - started,
					passed: false
				}
				evidence.cases.push(row)
				await save()
				assert.equal(chat.failure, null)
				assert.equal(outcomes.length, 1)
				assert.equal(hits - before, scenario.expectedHits)
				assert(
					chat.diagnostics.some(
						(event) => event.phase === 'verification' && event.reason === 'pass'
					)
				)
				if (scenario.expectedHits) assert.match(reply.content, /\b17\b/)
				else assert.doesNotMatch(reply.content, /\b17\b/)
				assert(!JSON.stringify(evidence).includes(secret))
				row.passed = true
				console.log(JSON.stringify({ name: scenario.name, answer: reply.content, passed: true }))
				await save()
			} finally {
				chat.stop()
			}
		}
		assert.equal(rejected, 0)
		evidence.passed = true
	} catch (error) {
		evidence.error = String(error)
		throw error
	} finally {
		server.closeAllConnections()
		await new Promise<void>((resolve) => server.close(() => resolve()))
		await save()
		console.log(`Evidence: ${out}/evidence.json`)
	}
} finally {
	await rm(keyDirectory, { recursive: true, force: true })
}
