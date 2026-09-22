import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
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
	imapQueryResultSchema,
	imapQuerySchema,
	imapReadSchema,
	queryDigest,
	readDigest
} from '../../libs/aven-mail/src/contracts'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { ConnectionArtifacts } from '../../services/credential-executor/src/artifacts'
import { connectionArtifactFixture } from './connection-artifact-fixture'
import { connectionIngressFixture } from './connection-ingress-fixture'
import { credentialDatabase } from './credential-database'
import { imapFixture } from './imap-fixture'

if (!process.env.AVEN_SYNTHETIC_IMAP) {
	const fixture = await imapFixture()
	try {
		const child = Bun.spawn([process.execPath, import.meta.path], {
			stdout: 'inherit',
			stderr: 'inherit',
			env: {
				...process.env,
				AVEN_SYNTHETIC_IMAP: JSON.stringify({
					directory: fixture.directory,
					login: fixture.login,
					password: fixture.password,
					port: fixture.port
				}),
				NODE_EXTRA_CA_CERTS: `${fixture.directory}/cert.pem`
			}
		})
		process.exitCode = await child.exited
	} finally {
		await fixture.close()
	}
} else {
	const fixture = JSON.parse(process.env.AVEN_SYNTHETIC_IMAP) as {
		directory: string
		login: string
		password: string
		port: number
	}
	const base = process.env.LIVE_LLM_BASE_URL,
		databaseUrl = process.env.CREDENTIAL_TEST_DATABASE_URL
	assert(base && databaseUrl)
	const model = process.env.LIVE_LLM_MODEL ?? 'qwen3.8-flash-next'
	assert(/qwen/i.test(model))
	const out = await mkdtemp('/tmp/aven-live-imap-proxy-')
	console.log(out)
	const evidence = {
		passed: false,
		synthetic: true,
		model,
		scope:
			'Real Qwen, ChatCore, TLS Dovecot, signed uses, restricted credential SQL and actual Rust Artifact Store with exact request/selection lineage and raw mail publication. Not deployed policy issuer, facade, tenant Store roles, UI or Studio proof.',
		cases: [] as Array<Record<string, unknown>>,
		fingerprints: {} as Record<string, string>,
		error: ''
	}
	const save = () => writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2))
	for (const file of [
		'deploy/e2e/live-imap-proxy.ts',
		'services/credential-executor/src/imap.ts',
		'libs/aven-mail/src/contracts.ts',
		'services/credential-executor/src/artifacts.ts',
		'services/credential-executor/src/handler.ts',
		'services/credential-executor/src/lifecycle.ts',
		'libs/aven-credential-storage/src/contracts.ts',
		'deploy/e2e/connection-ingress-fixture.ts',
		'libs/aven-artifact-store/src/run-store.ts',
		'deploy/e2e/connection-artifact-fixture.ts'
	])
		evidence.fingerprints[file] = createHash('sha256')
			.update(await readFile(file))
			.digest('hex')
	const environmentId = randomUUID(),
		subjectId = randomUUID(),
		credentialRef = randomUUID(),
		bindingRef = randomUUID(),
		accountRef = randomUUID()
	const scope = { environmentId, subjectId, generation: 1 },
		db = await credentialDatabase(databaseUrl, environmentId)
	let artifactFixture: Awaited<ReturnType<typeof connectionArtifactFixture>> | undefined
	let ingress: Awaited<ReturnType<typeof connectionIngressFixture>> | undefined
	try {
		const publicationScopeId = environmentId
		artifactFixture = await connectionArtifactFixture(db.databaseUrl, publicationScopeId)
		const artifactStore = artifactFixture.store
		const authorize = async (use: CredentialUse) => {
			assert.equal(use.environmentId, environmentId)
			assert.equal(use.subjectId, subjectId)
			assert.equal(use.sessionId, 'synthetic-session')
		}
		const artifacts = new ConnectionArtifacts(
			artifactStore,
			{ issuer: 'os.aven', subject: 'service:credential-executor' },
			authorize
		)
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
		const sealer = createCredentialSealer('test', pair.publicKey),
			unsealer = createCredentialUnsealer(new Map([['test', pair.privateKey]]))
		const envelope = await sealer.seal(Buffer.from(fixture.password), {
			environmentId,
			ownerSubjectId: subjectId,
			credentialRef,
			kind: 'password',
			secretVersion: 1
		})
		const admin = new CredentialAdminStore(db.pools.set, scope)
		await admin.command(randomUUID(), {
			action: 'create',
			credentialRef,
			expectedVersion: 0,
			label: 'Synthetic greenhouse mail',
			kind: 'password',
			envelope
		})
		await admin.command(randomUUID(), {
			action: 'binding-set',
			credentialRef,
			bindingRef,
			expectedVersion: 0,
			protocol: 'imap',
			profile: {
				label: 'Synthetic greenhouse mailbox',
				host: 'localhost',
				port: fixture.port,
				tls: 'implicit',
				authentication: 'password',
				login: fixture.login,
				accountRef,
				mailboxes: ['INBOX'],
				operations: ['query', 'read-message'],
				purpose: 'garden-research',
				maximumCommands: 30,
				maximumBytes: 1048576,
				maximumSeconds: 60
			}
		})
		const signing = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
			'sign',
			'verify'
		])) as CryptoKeyPair
		const sign = credentialUseSigner('https://policy.example.test', signing.privateKey)
		const verify = credentialUseVerifier('https://policy.example.test', signing.publicKey, 'imap')
		const grant = async (request: unknown, kind: 'query' | 'read') => {
			const parsed =
				kind === 'query' ? imapQuerySchema.parse(request) : imapReadSchema.parse(request)
			const source = 'selection' in parsed ? parsed.selection : parsed.continuation
			const [stored] = await artifactStore.publish({
				id: randomUUID(),
				procedure: 'connection.request',
				principal: subjectId,
				inputs: source ? [{ id: source.artifactId, role: 'selection' }] : [],
				parameters: {},
				artifacts: [
					{
						key: 'request',
						type: kind === 'query' ? 'mail.imap-query' : 'mail.imap-message-request',
						payload: parsed,
						references: source
							? [{ role: kind === 'query' ? 'continuation' : 'selection', id: source.artifactId }]
							: []
					}
				]
			})
			assert(stored)
			const requestOccurrenceId = stored.artifactId
			const use: CredentialUse = {
				authorizationId: randomUUID(),
				runId: randomUUID(),
				leaseOwnerId: randomUUID(),
				...scope,
				sessionId: 'synthetic-session',
				generation: 1,
				protocol: 'imap',
				capabilityId: `ceo.aven:capability:mail.imap-mailbox:imap_${kind === 'query' ? 'query' : 'read_message'}@1`,
				invocationId: randomUUID(),
				attemptId: randomUUID(),
				callerActorId: 'ceo.aven:actor:test:greenhouse@1',
				parentInvocationIds: [],
				bindingRef,
				bindingRevision: 1,
				credentialRef,
				secretVersion: 1,
				requestOccurrenceId,
				requestArtifactDigest: stored.artifactSha256,
				requestSchemaId: `ceo.aven:schema:mail:imap-${kind === 'query' ? 'query' : 'message-request'}@1`,
				operationDigest: kind === 'query' ? queryDigest(request) : readDigest(request),
				purpose: 'garden-research',
				policyRevision: 1,
				reviewRequestId: randomUUID(),
				reviewDecisionId: randomUUID(),
				mode: 'productive',
				publicationScopeId,
				maximumUnits: 30,
				maximumBytes: 1048576,
				issuedAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 45000).toISOString()
			}
			return sign(use)
		}
		ingress = await connectionIngressFixture({ ...scope, sessionId: 'synthetic-session' }, 'imap', {
			verify,
			forGrant: async (tenant) => {
				assert.equal(tenant.environmentId, environmentId)
				return {
					artifacts,
					authorize,
					store: new CredentialUseStore(db.pools.imap, scope, 'imap'),
					request: (use) => artifacts.request(use),
					selection: (use, source) => artifacts.selection(use, source),
					unsealer,
					allowedOrigins: [],
					localTestOrigins: [`https://localhost:${fixture.port}`]
				}
			}
		})
		const proxy = async (token: string, signal: AbortSignal) => {
			try {
				const response = await ingress!.execute(token, {}, signal),
					result = (await response.json()) as any
				if (!response.ok) throw Error(result.code)
				if (result.outcome === 'retained') return { outcome: 'already-claimed', state: 'succeeded' }
				assert.equal(response.status, 201)
				assert(!JSON.stringify(result).includes(fixture.password))
				assert(!JSON.stringify(result).includes(token))
				const published = await artifacts.lookup(await verify(token))
				assert(published)
				assert.deepEqual(
					result.artifacts.map((a: any) => a.artifactId),
					published.map((a) => a.artifactId)
				)
				const query = published.find((a) => a.typeKey === 'mail.imap-query-result')
				if (query) return query.payload
				const read = published.find((a) => a.typeKey === 'mail.imap-message-result')
				assert(read)
				const message = published.find((a) => a.typeKey === 'mail.message')
				return {
					...read.payload,
					...(message
						? {
								body: Buffer.from(
									await artifactStore.client.content(publicationScopeId, message.artifactId)
								),
								sha256: message.payload.sha256,
								mediaType: 'message/rfc822'
							}
						: {})
				}
			} finally {
				assert.equal(await db.unsettled(), 0, 'finished request must release only its own fence')
			}
		}
		const query = imapQuerySchema.parse({
			bindingRef,
			mailbox: 'INBOX',
			purpose: 'garden-research',
			metadata: ['internal-date', 'size', 'flags'],
			limits: { maximumCommands: 30 }
		})
		const token = await grant(query, 'query')
		for (const headers of [
			{ origin: 'https://foreign.example.test' },
			{ cookie: 'session=foreign' },
			{ authorization: 'Bearer invalid' },
			{ 'x-aven-session': 'wrong-session' }
		] as Array<Record<string, string>>) {
			assert.equal((await ingress.execute(token, headers)).status, 403)
		}
		const result = imapQueryResultSchema.parse(await proxy(token, new AbortController().signal))
		assert.equal(result.coverage, 'complete')
		assert.equal(result.messages.length, 3)
		const [storedResult] = (await artifacts.lookup(await verify(token)))!
		assert(storedResult)
		const id = storedResult.artifactId,
			digest = storedResult.artifactSha256
		const authority = await verify(token)
		await assert.rejects(() =>
			artifacts.request({ ...authority, requestArtifactDigest: '0'.repeat(64) })
		)
		await assert.rejects(() =>
			artifacts.request({ ...authority, publicationScopeId: randomUUID() })
		)
		await assert.rejects(() =>
			new ConnectionArtifacts(
				artifactStore,
				{ issuer: 'os.aven', subject: 'service:untrusted' },
				authorize
			).selection(authority, { artifactId: id, artifactDigest: digest })
		)
		await assert.rejects(() =>
			artifacts.publishImap(authority, {
				...result,
				scanFromUid: 2,
				scanned: [{ first: 2, last: result.nextUid - 1 }],
				messages: result.messages.filter((m) => m.uid >= 2)
			})
		)
		evidence.cases.push({
			name: 'wrong scope, forged store digest, untrusted publisher and missing scan prefix rejected'
		})
		const replay = await proxy(token, new AbortController().signal)
		assert.deepEqual(replay, { outcome: 'already-claimed', state: 'succeeded' })
		evidence.cases.push({ name: 'bounded query and replay', result, replay })
		await save()
		console.log('PASS real Dovecot query and replay')
		const partialQuery = imapQuerySchema.parse({
			...query,
			limits: { ...query.limits, maximumMatches: 1 }
		})
		let pageQuery = partialQuery
		let pageToken = await grant(pageQuery, 'query')
		let page = imapQueryResultSchema.parse(await proxy(pageToken, new AbortController().signal))
		assert.equal(page.coverage, 'truncated')
		assert.equal(page.messages.length, 1)
		const originalFence = page.upperUidExclusive,
			collected = page.messages.map((m) => m.uid)
		await writeFile(
			`${fixture.directory}/mail/new/synthetic-later`,
			'From: garden@example.test\r\nSubject: Later arrival\r\nMessage-ID: <later@example.test>\r\n\r\nThis arrived after the original query fence.\r\n'
		)
		while (page.coverage !== 'complete') {
			assert(collected.length < 3)
			const [storedPage] = (await artifacts.lookup(await verify(pageToken)))!
			assert(storedPage)
			const pageId = storedPage.artifactId,
				pageDigest = storedPage.artifactSha256
			pageQuery = imapQuerySchema.parse({
				...partialQuery,
				continuation: { artifactId: pageId, artifactDigest: pageDigest }
			})
			pageToken = await grant(pageQuery, 'query')
			page = imapQueryResultSchema.parse(await proxy(pageToken, new AbortController().signal))
			assert.equal(page.upperUidExclusive, originalFence)
			collected.push(...page.messages.map((m) => m.uid))
		}
		assert.deepEqual(
			collected,
			result.messages.map((m) => m.uid)
		)
		evidence.cases.push({ name: 'continuation excludes later arrivals', originalFence, collected })
		await save()
		const selectedRead = imapReadSchema.parse({
			bindingRef,
			accountRef,
			mailbox: 'INBOX',
			uidValidity: result.uidValidity,
			uid: result.messages[0]!.uid,
			purpose: 'garden-research',
			maximumBytes: 1,
			selection: { artifactId: id, artifactDigest: digest }
		})
		await assert.rejects(() => proxy('not-a-signed-authority', new AbortController().signal))
		await assert.rejects(() =>
			grant(selectedRead, 'read').then((token) => proxy(token, new AbortController().signal))
		)
		await assert.rejects(() =>
			grant(
				{ ...selectedRead, maximumBytes: 65536, uidValidity: result.uidValidity + 1 },
				'read'
			).then((token) => proxy(token, new AbortController().signal))
		)
		const cancelled = new AbortController()
		cancelled.abort()
		await assert.rejects(() =>
			grant(query, 'query').then((token) => proxy(token, cancelled.signal))
		)
		evidence.cases.push({
			name: 'invalid authority, oversized message, wrong epoch and cancellation rejected'
		})
		await save()
		const gateway = LlmGatewayService.fromConfig(
			testConfig({
				LLM_GATEWAY_ENABLED: 'true',
				LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
				LLM_GATEWAY_TIMEOUT_SECONDS: '180',
				LLM_GATEWAY_MODELS_JSON: JSON.stringify([
					{
						id: 'proof',
						label: 'Live IMAP proxy',
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
				for (const forbidden of [fixture.password, envelope.jwe.ciphertext])
					assert(!JSON.stringify(input).includes(forbidden))
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
		for (const scenario of [
			{
				name: 'English selected mail read',
				question:
					'Read the greenhouse messages and tell me how many violet seed packets there are. Keep it brief.',
				revoked: false
			},
			{
				name: 'German revoked mailbox',
				question:
					'Lies die Gewächshaus-Mails. Wie viele Samenpäckchen sind da? Wenn die Verbindung nicht verfügbar ist, sag das und erfinde keine Zahl.',
				revoked: true
			}
		]) {
			if (scenario.revoked)
				await admin.command(randomUUID(), {
					action: 'binding-revoke',
					credentialRef,
					bindingRef,
					protocol: 'imap',
					expectedVersion: 1
				})
			const calls: Array<Record<string, unknown>> = []
			const chat = new ChatCore(
				{},
				{
					specs: [
						{
							name: 'mail_read',
							answerReview: 'required',
							description:
								'Read the three previously selected greenhouse messages. Credentials remain private. A refusal has no message content; do not retry it.',
							parameters: { type: 'object', properties: {}, additionalProperties: false }
						}
					],
					run: async (name) => {
						assert.equal(name, 'mail_read')
						const messages: unknown[] = []
						for (const item of result.messages) {
							const request = imapReadSchema.parse({
								bindingRef,
								accountRef,
								mailbox: 'INBOX',
								uidValidity: result.uidValidity,
								uid: item.uid,
								purpose: 'garden-research',
								maximumBytes: 65536,
								selection: { artifactId: id, artifactDigest: digest }
							})
							try {
								const readToken = await grant(request, 'read')
								const response = (await proxy(readToken, new AbortController().signal)) as {
									outcome: string
									body?: Buffer
								}
								const captured = (await artifacts.lookup(await verify(readToken)))?.find(
									(a) => a.typeKey === 'mail.message'
								)
								const bytes = captured
									? Buffer.from(
											await artifactStore.client.content(publicationScopeId, captured.artifactId)
										)
									: undefined
								assert.deepEqual(bytes, response.body)
								messages.push(
									response.outcome === 'captured'
										? { outcome: 'captured', uid: item.uid, text: bytes!.toString('utf8') }
										: { outcome: 'unavailable' }
								)
							} catch {
								messages.push({
									outcome: 'unavailable',
									reason: 'No new observation: connection refused or unavailable. Do not retry.'
								})
								break
							}
						}
						calls.push({ name, messages })
						const record = JSON.stringify({ messages })
						return { record, wire: record }
					}
				},
				stream,
				stream
			)
			await chat.send(scenario.question)
			const answer = chat.turns.filter((t) => t.role === 'assistant').at(-1)?.content ?? ''
			evidence.cases.push({ ...scenario, answer, calls, failure: chat.failure, turns: chat.turns })
			await save()
			assert(!chat.failure)
			assert.equal(calls.length, 1)
			assert(answer.length > 10)
			assert.equal(/\b37\b/.test(answer), !scenario.revoked)
			console.log(`PASS ${scenario.name}`)
		}
		const filenames = [
			...(await readdir(`${fixture.directory}/mail/cur`)),
			...(await readdir(`${fixture.directory}/mail/new`))
		]
		assert.equal(filenames.length, 4)
		assert(
			filenames.every((name) => !/:2,[^/]*S/.test(name)),
			'Read marked a message Seen'
		)
		assert(!JSON.stringify(evidence).includes(fixture.password))
		assert(!JSON.stringify(evidence).includes(envelope.jwe.ciphertext))
		evidence.passed = true
	} catch (error) {
		evidence.error = error instanceof Error ? error.message : 'Proof failed'
		throw error
	} finally {
		await save()
		await ingress?.close()
		await artifactFixture?.close()
		await db.close()
	}
}
