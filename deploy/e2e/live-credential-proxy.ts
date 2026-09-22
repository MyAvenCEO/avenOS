/** Real Qwen + signed request authority + restricted SQL + actual TLS resource.
 * Component composition proof, not native/Studio or deployed facade qualification. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:https'
import { ChatCore } from '../../libs/aven-chat-engine/src/chat'
import {
	chatGatewayRequest,
	createGatewayModelStream
} from '../../libs/aven-chat-engine/src/gateway'
import {
	credentialUseSigner,
	credentialUseVerifier
} from '../../libs/aven-credential-storage/src/authority'
import type { CredentialUse } from '../../libs/aven-credential-storage/src/contracts'
import {
	createCredentialSealer,
	createCredentialUnsealer
} from '../../libs/aven-credential-storage/src/envelope'
import {
	CredentialAdminStore,
	CredentialUseStore
} from '../../libs/aven-credential-storage/src/postgres'
import {
	httpRequestDigest,
	parseHttpRequestArtifact
} from '../../libs/aven-http-resources/src/contracts'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { ConnectionArtifacts } from '../../services/credential-executor/src/artifacts'
import { connectionArtifactFixture } from './connection-artifact-fixture'
import { connectionIngressFixture } from './connection-ingress-fixture'
import { credentialDatabase } from './credential-database'

if (!process.env.AVEN_SYNTHETIC_TLS_DIRECTORY) {
	const directory = await mkdtemp('/tmp/aven-private-proxy-tls-')
	try {
		execFileSync(
			'openssl',
			[
				'req',
				'-x509',
				'-newkey',
				'rsa:2048',
				'-nodes',
				'-sha256',
				'-days',
				'1',
				'-keyout',
				`${directory}/key.pem`,
				'-out',
				`${directory}/cert.pem`,
				'-subj',
				'/CN=127.0.0.1',
				'-addext',
				'subjectAltName=IP:127.0.0.1'
			],
			{ stdio: 'ignore' }
		)
		const child = Bun.spawn([process.execPath, import.meta.path], {
			stdout: 'inherit',
			stderr: 'inherit',
			env: {
				...process.env,
				AVEN_SYNTHETIC_TLS_DIRECTORY: directory,
				NODE_EXTRA_CA_CERTS: `${directory}/cert.pem`
			}
		})
		process.exitCode = await child.exited
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
} else {
	const base = process.env.LIVE_LLM_BASE_URL,
		databaseUrl = process.env.CREDENTIAL_TEST_DATABASE_URL
	assert(base && databaseUrl, 'Configure the real Qwen and isolated test database.')
	const model = process.env.LIVE_LLM_MODEL ?? 'qwen3.8-flash-next'
	assert(/qwen/i.test(model))
	const out = await mkdtemp('/tmp/aven-live-credential-proxy-')
	console.log(out)
	const evidence = {
		passed: false,
		synthetic: true,
		model,
		startedAt: new Date().toISOString(),
		scope:
			'Real Qwen, ChatCore, actual TLS origin, signed per-request authority, restricted credential SQL/JWE and real Rust Artifact Store publication/replay. Not customer-facing policy, deployed isolation, tenant Store roles, UI or Studio proof.',
		fingerprints: {} as Record<string, string>,
		cases: [] as Array<Record<string, unknown>>,
		error: ''
	}
	for (const file of [
		'deploy/e2e/live-credential-proxy.ts',
		'libs/aven-credential-storage/src/authority.ts',
		'libs/aven-credential-storage/src/postgres.ts',
		'services/credential-executor/src/http.ts',
		'services/credential-executor/src/artifacts.ts',
		'services/credential-executor/src/handler.ts',
		'services/credential-executor/src/lifecycle.ts',
		'libs/aven-http-resources/src/transport.ts',
		'libs/aven-credential-storage/src/contracts.ts',
		'deploy/e2e/connection-ingress-fixture.ts',
		'libs/aven-artifact-store/src/run-store.ts',
		'deploy/e2e/connection-artifact-fixture.ts',
		'services/platform-provisioner/components/credentials/0001_credentials.sql'
	])
		evidence.fingerprints[file] = createHash('sha256')
			.update(await readFile(file))
			.digest('hex')
	const save = () => writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2))
	const environmentId = randomUUID(),
		subjectId = randomUUID(),
		credentialRef = randomUUID(),
		bindingRef = randomUUID()
	const scope = { environmentId, subjectId, generation: 1 },
		db = await credentialDatabase(databaseUrl, environmentId)
	let server: ReturnType<typeof createServer> | undefined
	let artifactFixture: Awaited<ReturnType<typeof connectionArtifactFixture>> | undefined
	let ingress: Awaited<ReturnType<typeof connectionIngressFixture>> | undefined
	const secret = randomUUID(),
		wire: { hits: number; rejected: number } = { hits: 0, rejected: 0 }
	let holdResponse: ((send: () => void) => void) | undefined
	try {
		const publicationScopeId = environmentId
		artifactFixture = await connectionArtifactFixture(db.databaseUrl, publicationScopeId)
		const artifactStore = artifactFixture.store
		const authorize = async (grant: CredentialUse) => {
			assert.equal(grant.environmentId, environmentId)
			assert.equal(grant.subjectId, subjectId)
			assert.equal(grant.sessionId, 'synthetic-current-session')
		}
		const artifacts = new ConnectionArtifacts(
			artifactStore,
			{ issuer: 'os.aven', subject: 'service:credential-executor' },
			authorize
		)
		const directory = process.env.AVEN_SYNTHETIC_TLS_DIRECTORY
		server = createServer(
			{
				key: await readFile(`${directory}/key.pem`),
				cert: await readFile(`${directory}/cert.pem`)
			},
			(req, res) => {
				if (req.headers.authorization !== `Bearer ${secret}` || req.url !== '/inventory') {
					wire.rejected++
					res.writeHead(403).end()
					return
				}
				wire.hits++
				const send = () => {
					res.setHeader('content-type', 'application/json')
					res.end(JSON.stringify({ item: 'wooden birds', count: 23, unit: 'pieces' }))
				}
				if (holdResponse) holdResponse(send)
				else send()
			}
		)
		await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
		const port = (server.address() as { port: number }).port,
			origin = `https://127.0.0.1:${port}`
		const pair = await crypto.subtle.generateKey(
			{
				name: 'RSA-OAEP',
				modulusLength: 3072,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: 'SHA-256'
			},
			false,
			['encrypt', 'decrypt']
		)
		const sealer = createCredentialSealer('synthetic', pair.publicKey),
			unsealer = createCredentialUnsealer(new Map([['synthetic', pair.privateKey]]))
		const envelope = await sealer.seal(Buffer.from(secret), {
			environmentId,
			ownerSubjectId: subjectId,
			credentialRef,
			kind: 'token',
			secretVersion: 1
		})
		const admin = new CredentialAdminStore(db.pools.set, scope)
		await admin.command(randomUUID(), {
			action: 'create',
			credentialRef,
			expectedVersion: 0,
			label: 'Fictional craft inventory',
			kind: 'token',
			envelope
		})
		await admin.command(randomUUID(), {
			action: 'binding-set',
			credentialRef,
			bindingRef,
			expectedVersion: 0,
			protocol: 'http',
			profile: {
				label: 'Fictional craft inventory',
				placements: ['server'],
				schemes: ['https'],
				host: { kind: 'exact', value: '127.0.0.1' },
				ports: [port],
				pathPrefix: '/inventory',
				methods: ['GET'],
				purpose: 'inventory-read',
				attachment: { kind: 'header', name: 'authorization', prefix: 'Bearer ' }
			}
		})
		const request = parseHttpRequestArtifact({
			method: 'GET',
			url: `${origin}/inventory`,
			authentication: { mode: 'mapped-required', purpose: 'inventory-read' },
			freshness: 'new-capture'
		})
		const [storedRequest] = await artifactStore.publish({
			id: randomUUID(),
			procedure: 'connection.request',
			principal: subjectId,
			inputs: [],
			parameters: {},
			artifacts: [{ key: 'request', type: 'web.http-request', payload: request }]
		})
		assert(storedRequest)
		const operationDigest = httpRequestDigest(request),
			requestOccurrenceId = storedRequest.artifactId,
			requestArtifactDigest = storedRequest.artifactSha256
		const signing = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
			'sign',
			'verify'
		])) as CryptoKeyPair
		const sign = credentialUseSigner('https://policy.example.test', signing.privateKey)
		const verify = credentialUseVerifier('https://policy.example.test', signing.publicKey, 'http')
		const use = (): CredentialUse => ({
			authorizationId: randomUUID(),
			runId: randomUUID(),
			leaseOwnerId: randomUUID(),
			...scope,
			sessionId: 'synthetic-current-session',
			generation: 1,
			protocol: 'http',
			capabilityId: 'ceo.aven:capability:web.http-fetch:http_fetch_authenticated@1',
			invocationId: randomUUID(),
			attemptId: randomUUID(),
			callerActorId: 'ceo.aven:actor:test:inventory@1',
			parentInvocationIds: [],
			bindingRef,
			bindingRevision: 1,
			credentialRef,
			secretVersion: 1,
			requestOccurrenceId,
			requestArtifactDigest,
			requestSchemaId: 'ceo.aven:schema:web:http-request@1',
			operationDigest,
			purpose: 'inventory-read',
			policyRevision: 1,
			reviewRequestId: randomUUID(),
			reviewDecisionId: randomUUID(),
			mode: 'productive',
			publicationScopeId,
			maximumUnits: 1,
			maximumBytes: 4096,
			issuedAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 45000).toISOString()
		})
		const host: Parameters<typeof connectionIngressFixture>[2] = {
			verify,
			forGrant: async (grant) => {
				assert.equal(grant.environmentId, environmentId)
				return {
					artifacts,
					authorize,
					store: new CredentialUseStore(db.pools.http, scope, 'http'),
					request: (use) => artifacts.request(use),
					selection: async () => {
						throw Error('Not an IMAP host')
					},
					unsealer,
					allowedOrigins: [],
					localTestOrigins: [origin]
				}
			}
		}
		const ingressScope = { ...scope, sessionId: 'synthetic-current-session' }
		ingress = await connectionIngressFixture(ingressScope, 'http', host)
		// Real sockets stay open while a duplicate reaches the SQL claim boundary.
		let arrived!: () => void, release!: () => void
		let arrivedPromise = new Promise<void>((done) => {
			arrived = done
		})
		holdResponse = (send) => {
			release = send
			arrived()
		}
		const heldUse = use(),
			heldToken = await sign(heldUse)
		const held = ingress.execute(heldToken, {}, AbortSignal.timeout(10000))
		await Promise.race([
			arrivedPromise,
			held.then(() => {
				throw Error('request ended before fixture barrier')
			})
		])
		assert.equal(await db.unsettled(), 1)
		console.log('PASS first request holds a lifecycle marker')
		const duplicate = await ingress.execute(heldToken)
		assert.equal(duplicate.status, 409)
		assert.equal(await db.unsettled(), 1, 'duplicate must not release the original capture fence')
		release()
		assert.equal((await held).status, 201)
		assert.equal(await db.unsettled(), 0)
		console.log('PASS concurrent duplicate cannot release the marker')
		const capturedHits = wire.hits
		assert.equal((await ingress.execute(heldToken)).status, 200)
		assert.equal(wire.hits, capturedHits)
		await assert.rejects(() => artifacts.lookup({ ...heldUse, secretVersion: 2 }))
		await assert.rejects(() => artifacts.lookup({ ...heldUse, bindingRevision: 2 }))
		await assert.rejects(() => artifacts.lookup({ ...heldUse, policyRevision: 2 }))
		const interrupted = await connectionIngressFixture(ingressScope, 'http', host)
		try {
			arrivedPromise = new Promise<void>((done) => {
				arrived = done
			})
			const interruptedUse = use(),
				interruptedToken = await sign(interruptedUse)
			const pending = interrupted
				.execute(interruptedToken, {}, AbortSignal.timeout(10000))
				.catch(() => null)
			await Promise.race([
				arrivedPromise,
				pending.then(() => {
					throw Error('request ended before cancellation barrier')
				})
			])
			assert.equal(await db.unsettled(), 1)
			console.log('Checking private service shutdown during an unfinished response')
			await interrupted.close()
			await pending
			assert.equal(await db.unsettled(), 0)
			assert.equal(await artifacts.lookup(interruptedUse), null)
			assert.equal((await ingress.execute(interruptedToken)).status, 409)
		} finally {
			holdResponse = undefined
			await interrupted.close()
		}
		evidence.cases.push({
			name: 'private ingress concurrent replay, shutdown, settlement and version partition',
			passed: true
		})
		const proxy = async (token: string, signal: AbortSignal) => {
			try {
				const response = await ingress!.execute(token, {}, signal),
					result = (await response.json()) as any
				if (!response.ok) throw Error(result.code)
				if (result.outcome === 'retained')
					return { outcome: 'already-claimed' as const, state: 'succeeded' as const }
				assert.equal(response.status, 201)
				assert.equal(result.artifacts.length, 1)
				const stored = await artifactStore.get(result.artifacts[0].artifactId)
				assert.equal(stored.typeKey, 'web.http-response')
				assert(!JSON.stringify(result).includes(secret))
				assert(!JSON.stringify(result).includes(token))
				return {
					outcome: 'captured' as const,
					status: Number(stored.payload.statusCode),
					protocol: String(stored.payload.protocol),
					headers: stored.payload.headers as Array<{ name: string; values: string[] }>,
					body: Buffer.from(
						await artifactStore.client.content(publicationScopeId, stored.artifactId)
					),
					capturedAt: String(stored.payload.capturedAt),
					redirectLocation: null,
					redirectBlocked: false
				}
			} finally {
				assert.equal(await db.unsettled(), 0, 'finished request must release only its own fence')
			}
		}
		const gateway = LlmGatewayService.fromConfig(
			testConfig({
				LLM_GATEWAY_ENABLED: 'true',
				LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
				LLM_GATEWAY_TIMEOUT_SECONDS: '180',
				LLM_GATEWAY_MODELS_JSON: JSON.stringify([
					{
						id: 'proof',
						label: 'Live credential proxy',
						baseUrl: base,
						upstreamModel: model,
						profile: 'qwen-tools',
						authMode: 'none',
						capabilities: ['text-generation', 'streaming', 'tool-calling', 'structured-output']
					}
				])
			})
		)
		assert(gateway)
		const stream = createGatewayModelStream({
			request: (input) => {
				for (const forbidden of [secret, envelope.jwe.ciphertext])
					assert(
						!JSON.stringify(input).includes(forbidden),
						'Private material entered a model request'
					)
				return chatGatewayRequest({ ...input, model: 'proof' }, 16384)
			},
			open: async function* (input, signal) {
				const response = await gateway.openAiChatCompletion(input, signal)
				assert(response.ok && response.body)
				const decoder = new TextDecoder()
				for await (const chunk of response.body) yield decoder.decode(chunk, { stream: true })
				yield decoder.decode()
			}
		})
		const original = await sign(use())
		const beforeGuards = wire.hits
		for (const headers of [
			{ origin: 'https://untrusted.example.test' },
			{ cookie: 'session=foreign' },
			{ authorization: 'Bearer invalid' },
			{ 'x-aven-session': 'wrong-session' },
			{ 'x-aven-work-grant': 'invalid' }
		] as Array<Record<string, string>>) {
			assert.equal((await ingress.execute(original, headers)).status, 403)
		}
		assert.equal(wire.hits, beforeGuards)
		for (const scenario of [
			{
				name: 'authorized HTTPS read',
				token: original,
				expectedHits: 1,
				question:
					'Check the craft inventory connection. How many wooden birds are available? Answer briefly.',
				success: true
			},
			{
				name: 'same claimed request cannot send twice',
				token: original,
				expectedHits: 0,
				question:
					'Prüfe den Bestand der Holzvögel. Wenn die Verbindung kein neues Ergebnis liefert, sag klar, dass der aktuelle Bestand unbekannt ist. Nicht erneut versuchen.',
				success: false
			},
			{
				name: 'wrong protocol',
				token: await sign({ ...use(), protocol: 'imap' }),
				expectedHits: 0,
				question:
					'Combien d’oiseaux en bois sont disponibles ? Consulte la connexion. Si elle refuse, indique que le stock est inconnu, pas nul.',
				success: false
			},
			{
				name: 'revoked binding',
				token: await sign(use()),
				expectedHits: 0,
				question:
					'Quanti uccellini di legno sono disponibili? Controlla la connessione. Se non riesci, non inventare un numero e non riprovare.',
				success: false
			}
		]) {
			if (scenario.name === 'revoked binding')
				await admin.command(randomUUID(), {
					action: 'binding-revoke',
					credentialRef,
					bindingRef,
					expectedVersion: 1,
					protocol: 'http'
				})
			const before = wire.hits,
				calls: Array<Record<string, unknown>> = []
			const chat = new ChatCore(
				{},
				{
					specs: [
						{
							name: 'inventory_read',
							answerReview: 'required',
							description:
								'Read the inventory through its configured connection. Authentication is handled privately. A refusal or replay has no fresh count; report the limit and do not retry.',
							parameters: { type: 'object', properties: {}, additionalProperties: false }
						}
					],
					run: async (name) => {
						assert.equal(name, 'inventory_read')
						let result: unknown
						try {
							const response = await proxy(scenario.token, new AbortController().signal)
							let content: string | undefined
							if (response.outcome === 'captured') {
								const authority = await verify(scenario.token)
								const published = await artifacts.publishHttp(authority, response)
								const replayed = await artifacts.publishHttp(authority, response)
								assert.deepEqual(
									replayed.map((a) => a.artifactId),
									published.map((a) => a.artifactId)
								)
								assert.deepEqual(
									(await artifacts.lookup(authority))?.map((a) => a.artifactId),
									published.map((a) => a.artifactId)
								)
								const bytes = Buffer.from(
									await artifactStore.client.content(publicationScopeId, published[0]!.artifactId)
								)
								assert.deepEqual(bytes, response.body)
								content = bytes.toString('utf8')
							}
							result =
								response.outcome === 'captured'
									? {
											outcome: 'observed',
											status: response.status,
											content
										}
									: {
											outcome: 'unavailable',
											reason: 'Request already claimed; no new observation. Do not retry.'
										}
						} catch {
							result = {
								outcome: 'unavailable',
								reason:
									'Connection did not authorize or complete a new observation. No current count is available. Do not retry.'
							}
						}
						calls.push({ name, result })
						const record = JSON.stringify(result)
						return { record, wire: record }
					}
				},
				stream,
				stream
			)
			await chat.send(scenario.question)
			const answer = chat.turns.filter((t) => t.role === 'assistant').at(-1)?.content ?? ''
			evidence.cases.push({
				name: scenario.name,
				question: scenario.question,
				answer,
				calls,
				wireHits: wire.hits - before,
				failure: chat.failure,
				turns: chat.turns
			})
			await save()
			assert.equal(wire.hits - before, scenario.expectedHits)
			assert.equal(wire.rejected, 0)
			assert.equal(calls.length, 1)
			assert(answer.length > 10)
			assert(!chat.failure)
			if (scenario.success) assert(/\b23\b/.test(answer))
			else assert(!/\b23\b/.test(answer))
			assert(!JSON.stringify(evidence).includes(secret))
			assert(!JSON.stringify(evidence).includes(envelope.jwe.ciphertext))
			console.log(`PASS ${scenario.name}`)
		}
		evidence.passed = true
	} catch (error) {
		evidence.error = error instanceof Error ? error.message : 'Proof failed'
		throw error
	} finally {
		await save()
		await ingress?.close()
		server?.closeAllConnections()
		if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
		await artifactFixture?.close()
		await db.close()
	}
}
