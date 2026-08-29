import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { expect, test } from '@playwright/test'
import pg from 'pg'
import { ACTOR_RUN_PROTOCOL } from '../../libs/aven-actors/src/index.js'
import {
	databaseNameForEnvironment,
	databaseRoleName,
	deriveDatabasePassword
} from '../../libs/aven-customer-contracts/src/index.js'
import { signWebhookHeaders } from '../../services/checkout/src/lib/server/billing/provider.js'
import { TauriSession } from './tauri-driver.js'

const identity = process.env.E2E_IDENTITY_ORIGIN as string
const identityBrowser = process.env.E2E_IDENTITY_BROWSER_ORIGIN as string
const checkout = process.env.E2E_CHECKOUT_ORIGIN as string
const checkoutBrowser = process.env.E2E_CHECKOUT_BROWSER_ORIGIN as string
const api = process.env.E2E_API_ORIGIN as string
const staticHost = process.env.E2E_STATIC_ORIGIN as string
const mailpit = process.env.E2E_MAILPIT_ORIGIN as string
const databaseUrl = process.env.E2E_DATABASE_URL as string
const tauriApplication = process.env.E2E_TAURI_APPLICATION as string
const tauriDriver = process.env.E2E_TAURI_DRIVER as string
const tauriFixture = process.env.E2E_TAURI_FIXTURE as string
const provisioningSecret = 'identity-provisioning-secret-for-e2e-only'
const directorySecret = 'site-host-directory-token-for-e2e-only'

function requireEnvironment() {
	for (const [name, value] of Object.entries({
		identity,
		identityBrowser,
		checkout,
		checkoutBrowser,
		api,
		staticHost,
		mailpit,
		databaseUrl,
		tauriApplication,
		tauriDriver,
		tauriFixture
	}))
		if (!value) throw new Error(`${name} is required`)
}

interface TauriAcceptance {
	intentId: string
	sourceArtifactId: string
	extractedTextArtifactId: string
}

async function tauriAcceptance(
	page: import('@playwright/test').Page,
	environmentId: string,
	authorizedHeaders: Record<string, string>
): Promise<TauriAcceptance> {
	const session = await TauriSession.launch(tauriApplication, tauriDriver)
	try {
		await session.waitForBodyText('GERÄTECODE')
		const body = await session.bodyText()
		const code = body.match(/\b([A-Z0-9]{4})-([A-Z0-9]{4})\b/)
		if (!code) throw new Error(`Tauri did not display a device code:\n${body}`)
		await page.goto(`${identityBrowser}/device?user_code=${code[1]}${code[2]}`)
		await expect(page.getByRole('heading', { name: 'Authorize this device' })).toBeVisible()
		await page.getByRole('button', { name: 'Authorize' }).click()
		await expect(page.getByRole('heading', { name: 'Device connected' })).toBeVisible()
		await session.waitForBodyText('Process on')
		const dashboard = new URL(await session.url())
		dashboard.pathname = '/dashboard'
		dashboard.searchParams.set('e2eFixture', tauriFixture)
		await session.navigate(dashboard.toString())
		const importButton = await session.findEventually('[data-testid="e2e-import-fixture"]')
		await session.click(importButton)

		const artifactBase = `${api}/api/environments/${environmentId}/artifacts`
		let sourceArtifactId = ''
		let extractedTextArtifactId = ''
		let lastArtifactResponse = 'not requested'
		const artifactDeadline = Date.now() + 90_000
		while (Date.now() < artifactDeadline) {
			const response = await fetch(artifactBase, { headers: authorizedHeaders })
			lastArtifactResponse = `${response.status} ${await response.clone().text()}`
			if (response.ok) {
				const browse = (await response.json()) as {
					artifacts: Array<{ artifactId: string; typeKey: string }>
				}
				sourceArtifactId =
					browse.artifacts.find((artifact) => artifact.typeKey === 'core.file')?.artifactId ?? ''
				extractedTextArtifactId =
					browse.artifacts.find((artifact) => artifact.typeKey === 'docs.extracted-text')
						?.artifactId ?? ''
				const types = new Set(browse.artifacts.map((artifact) => artifact.typeKey))
				if (
					sourceArtifactId &&
					extractedTextArtifactId &&
					types.has('core.file-inspection') &&
					types.has('core.content-classification')
				)
					break
			}
			await new Promise((resolve) => setTimeout(resolve, 250))
		}
		if (!sourceArtifactId || !extractedTextArtifactId)
			throw new Error(
				`Tauri import did not publish source and derived text artifacts; artifact API: ${lastArtifactResponse}\nTauri body:\n${await session.bodyText()}`
			)
		const fixture = await readFile(tauriFixture, 'utf8')
		for (const [artifactId, expected] of [
			[sourceArtifactId, fixture],
			[extractedTextArtifactId, fixture.trim()]
		] as const) {
			const content = await fetch(`${artifactBase}/${artifactId}/content`, {
				headers: authorizedHeaders
			})
			expect(content.status).toBe(200)
			expect(await content.text()).toBe(expected)
		}

		const intentBase = `${api}/api/environments/${environmentId}/intents`
		let intentId = ''
		const intentDeadline = Date.now() + 30_000
		while (Date.now() < intentDeadline) {
			const intents = (await json(
				await fetch(intentBase, { headers: authorizedHeaders })
			)) as Array<{
				id: string
				title: string
			}>
			intentId = intents.find((intent) => intent.title === 'e2e-document.txt')?.id ?? ''
			if (intentId) break
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		if (!intentId) throw new Error('Tauri import did not create its customer intent')

		await session.execute(
			"window.dispatchEvent(new KeyboardEvent('keydown', { key: 'H', bubbles: true }))"
		)
		const composer = await session.findEventually('textarea[placeholder="Sprich — oder schreib…"]')
		await session.type(composer, 'ello from Tauri E2E')
		await session.click(await session.find('button[aria-label="Senden"]'))
		await session.waitForBodyText('E2E chat reply.')

		const contributionDeadline = Date.now() + 30_000
		while (Date.now() < contributionDeadline) {
			const detail = (await json(
				await fetch(`${intentBase}/${intentId}`, { headers: authorizedHeaders })
			)) as {
				contributions: Array<{ contributorKind: string; text: string | null }>
			}
			if (
				detail.contributions.some(
					(entry) => entry.contributorKind === 'human' && entry.text === 'Hello from Tauri E2E'
				) &&
				detail.contributions.some(
					(entry) => entry.contributorKind === 'agent' && entry.text === 'E2E chat reply.'
				)
			)
				return { intentId, sourceArtifactId, extractedTextArtifactId }
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		throw new Error('Tauri chat exchange was not persisted to the customer intent')
	} finally {
		await session.close()
	}
}

async function json(response: Response) {
	const body = await response.json().catch(() => null)
	if (!response.ok)
		throw new Error(`${response.url} returned ${response.status}: ${JSON.stringify(body)}`)
	return body
}

async function hostedDocument(
	origin: string,
	hostname: string
): Promise<{ ok: boolean; status: number; text: string }> {
	const url = new URL(origin)
	return new Promise((resolve, reject) => {
		const request = httpRequest(
			{
				hostname: url.hostname,
				port: url.port,
				path: '/',
				method: 'GET',
				headers: { host: hostname }
			},
			(response) => {
				const chunks: Buffer[] = []
				response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
				response.on('end', () => {
					const status = response.statusCode ?? 0
					resolve({
						ok: status >= 200 && status < 300,
						status,
						text: Buffer.concat(chunks).toString()
					})
				})
			}
		)
		request.on('error', reject)
		request.end()
	})
}

function leadingZeroBits(digest: Buffer, bits: number): boolean {
	const bytes = Math.floor(bits / 8)
	for (let index = 0; index < bytes; index += 1) if (digest[index] !== 0) return false
	const remaining = bits % 8
	return remaining === 0 || ((digest[bytes] ?? 255) & (0xff << (8 - remaining))) === 0
}

async function proofOfWork(purpose: string): Promise<string> {
	const challenge = (await json(
		await fetch(`${checkout}/api/pow/challenge?purpose=${encodeURIComponent(purpose)}`)
	)) as { id: string; nonce: string; purpose: string; difficultyBits: number }
	for (let counter = 0; counter < 10_000_000; counter += 1) {
		const digest = createHash('sha256')
			.update(`${challenge.id}:${challenge.nonce}:${challenge.purpose}:${counter}`)
			.digest()
		if (leadingZeroBits(digest, challenge.difficultyBits)) return `${challenge.id}.${counter}`
	}
	throw new Error('proof of work search limit exceeded')
}

interface MailSummary {
	ID: string
	Subject: string
}

async function waitForMail(subject: RegExp): Promise<{ text: string; html: string }> {
	const deadline = Date.now() + 30_000
	while (Date.now() < deadline) {
		const list = (await json(await fetch(`${mailpit}/api/v1/messages`))) as {
			messages?: MailSummary[]
		}
		for (const message of list.messages ?? []) {
			if (!subject.test(message.Subject)) continue
			const detail = (await json(await fetch(`${mailpit}/api/v1/message/${message.ID}`))) as {
				Text?: string
				HTML?: string
			}
			return { text: detail.Text ?? '', html: detail.HTML ?? '' }
		}
		await new Promise((resolve) => setTimeout(resolve, 250))
	}
	throw new Error(`mail matching ${subject} did not arrive`)
}

function linkFrom(mail: { text: string; html: string }, host: string): string {
	const decoded = mail.html.replaceAll('&amp;', '&')
	const match = `${mail.text}\n${decoded}`.match(
		new RegExp(`https?://${host.replaceAll('.', '\\.')}[^\\s"<>]+`)
	)
	if (!match) throw new Error(`mail contained no ${host} link`)
	return match[0]
}

async function deviceSession(page: import('@playwright/test').Page): Promise<string> {
	const issued = (await json(
		await fetch(`${identity}/api/auth/device/code`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ client_id: 'ceo.aven.os' })
		})
	)) as {
		device_code: string
		verification_uri_complete: string
		user_code: string
		interval: number
	}
	await page.goto(issued.verification_uri_complete)
	await expect(page.getByRole('heading', { name: 'Authorize this device' })).toBeVisible()
	await expect(page.getByText(`Code: ${issued.user_code}`)).toBeVisible()
	await page.getByRole('button', { name: 'Authorize' }).click()
	await expect(page.getByRole('heading', { name: 'Device connected' })).toBeVisible()
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const response = await fetch(`${identity}/api/auth/device/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
				device_code: issued.device_code,
				client_id: 'ceo.aven.os'
			})
		})
		const body = (await response.json()) as { access_token?: string; error?: string }
		if (response.ok && body.access_token) return body.access_token
		if (!['authorization_pending', 'slow_down'].includes(body.error ?? ''))
			throw new Error(`device token failed: ${response.status} ${JSON.stringify(body)}`)
		await new Promise((resolve) => setTimeout(resolve, Math.max(issued.interval, 1) * 1000))
	}
	throw new Error('device token was not issued')
}

test('fresh split stack: checkout, identity, facade, and managed hosting', async ({ browser }) => {
	test.setTimeout(300_000)
	requireEnvironment()
	const context = await browser.newContext()
	await context.credentials.install()
	const page = await context.newPage()

	await expect((await fetch(`${identity}/api/health/ready`)).status).toBe(200)
	await expect((await fetch(`${checkout}/api/health/ready`)).status).toBe(200)
	await expect((await fetch(`${api}/health/live`)).status).toBe(200)
	await expect((await fetch(`${api}/api/billing/me`)).status).toBe(401)
	await expect(
		(
			await fetch(`${identity}/internal/v1/authorizations/roles`, {
				method: 'POST',
				headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
				body: JSON.stringify({ subjectIds: [] })
			})
		).status
	).toBe(401)
	const ignoredDeliveryId = `msg_${crypto.randomUUID()}`
	const ignoredWebhookBody = JSON.stringify({
		type: 'future.feature.created',
		data: { id: crypto.randomUUID(), future: { retained: true } }
	})
	const ignoredWebhookHeaders = signWebhookHeaders(
		ignoredWebhookBody,
		'polar-webhook-e2e',
		ignoredDeliveryId
	)
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const response = await fetch(`${checkout}/api/webhooks/polar`, {
			method: 'POST',
			headers: { ...ignoredWebhookHeaders, 'content-type': 'application/json' },
			body: ignoredWebhookBody
		})
		expect(response.status).toBe(200)
	}

	const name = `e2e-${Date.now().toString(36)}`.slice(0, 28)
	const email = `${name}@example.test`
	const held = await fetch(`${checkout}/api/names/hold`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			origin: checkoutBrowser,
			'x-proof-of-work': await proofOfWork('secure-name')
		},
		body: JSON.stringify({ name, email, tier: 'aven-name' })
	})
	if (held.status !== 201) throw new Error(`name hold failed: ${held.status} ${await held.text()}`)

	const claimMail = await waitForMail(new RegExp(`Checkout link for ${name}`))
	const claimUrl = linkFrom(claimMail, new URL(checkoutBrowser).host)
	await page.goto(claimUrl)
	await expect(page.getByText(`${name}.aven.ceo`)).toBeVisible()
	await page.getByRole('button', { name: 'Pay' }).click()
	await expect(page).toHaveURL(/\/purchase\/success/)

	const setupMail = await waitForMail(new RegExp(`Login for ${name}`))
	const setupUrl = linkFrom(setupMail, new URL(identityBrowser).host)
	await page.goto(setupUrl)
	await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible()
	await page.getByRole('button', { name: 'Add passkey' }).click()
	await expect(page.locator('ul.passkeys li')).toHaveCount(1)
	const [firstCredential] = await context.credentials.get({ rpId: 'localhost' })
	expect(firstCredential).toBeDefined()

	// A second passkey represents another authenticator/device. A conforming authenticator
	// refuses to enroll itself twice for the same account, so preserve the session in a new
	// browser context with a separate virtual authenticator.
	const secondContext = await browser.newContext({ storageState: await context.storageState() })
	await secondContext.credentials.install()
	const secondPage = await secondContext.newPage()
	await secondPage.goto(`${identityBrowser}/dashboard`)
	await expect(secondPage.locator('ul.passkeys li')).toHaveCount(1)
	await secondPage.getByRole('button', { name: 'Add another passkey' }).click()
	await expect(secondPage.locator('ul.passkeys li')).toHaveCount(2)
	const [secondCredential] = await secondContext.credentials.get({ rpId: 'localhost' })
	expect(secondCredential).toBeDefined()
	expect(secondCredential.id).not.toBe(firstCredential.id)

	await secondPage.getByRole('button', { name: 'Sign out' }).click()
	await expect(secondPage).toHaveURL(`${identityBrowser}/login`)
	await secondPage.getByRole('button', { name: 'Continue with passkey' }).click()
	await expect(secondPage.getByRole('heading', { name: 'Your account' })).toBeVisible()

	const secondName = `${name}-other`.slice(0, 28)
	const secondNameHold = await fetch(`${checkout}/api/names/hold`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			origin: checkoutBrowser,
			'x-proof-of-work': await proofOfWork('secure-name')
		},
		body: JSON.stringify({ name: secondName, email, tier: 'aven-name' })
	})
	expect(secondNameHold.status).toBe(409)
	expect(await secondNameHold.json()).toMatchObject({ code: 'NAME_LIMIT_REACHED' })

	const sessionToken = await deviceSession(secondPage)
	const tokenBody = (await json(
		await fetch(`${identity}/api/auth/token`, {
			headers: { authorization: `Bearer ${sessionToken}` }
		})
	)) as { token: string }
	const claims = JSON.parse(Buffer.from(tokenBody.token.split('.')[1], 'base64url').toString()) as {
		sub: string
		iss: string
		aud: string
		amr: string[]
		scope: string
		exp: number
		iat: number
	}
	expect(claims.iss).toBe(identityBrowser)
	expect(claims.aud).toBe('aven-services')
	expect(claims.amr).toContain('passkey')
	expect(claims.scope.split(' ')).toContain('services:access')
	expect(claims.exp - claims.iat).toBeLessThanOrEqual(300)

	const authorizedHeaders = {
		authorization: `Bearer ${tokenBody.token}`,
		origin: checkoutBrowser
	}
	const billing = await fetch(`${api}/api/billing/me`, { headers: authorizedHeaders })
	await expect(billing.status).toBe(200)
	await expect(billing.headers.get('access-control-allow-origin')).toBe(checkoutBrowser)
	await expect(await billing.json()).toEqual({ subscriptions: [] })

	const forged = await fetch(`${api}/api/billing/me`, {
		headers: { ...authorizedHeaders, 'x-aven-subject': 'forged', 'x-aven-role': 'admin' }
	})
	await expect(forged.status).toBe(200)
	const facadeOnly = await fetch(`${checkout}/api/billing/me`, {
		headers: { authorization: 'Bearer checkout-facade-token-for-e2e-only' }
	})
	await expect(facadeOnly.status).toBe(401)

	let environment:
		| {
				id: string
				observedState: string
				routingGeneration: number
				components: { componentRef: string; observedState: string }[]
		  }
		| undefined
	const environmentDeadline = Date.now() + 60_000
	while (Date.now() < environmentDeadline) {
		const response = await fetch(`${api}/api/environments`, { headers: authorizedHeaders })
		expect(response.status).toBe(200)
		const body = (await response.json()) as { environments: (typeof environment)[] }
		environment = body.environments.find(
			(candidate) =>
				candidate.observedState === 'ready' &&
				candidate.components.every((component) => component.observedState === 'ready')
		)
		if (environment) break
		await new Promise((resolve) => setTimeout(resolve, 250))
	}
	if (!environment) throw new Error('customer environment did not reconcile')
	const tauri = await tauriAcceptance(secondPage, environment.id, authorizedHeaders)
	const secondEntitlement = await fetch(`${api}/internal/v1/customer-entitlement-events`, {
		method: 'POST',
		headers: {
			authorization: 'Bearer customer-entitlement-token-for-e2e',
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			eventId: crypto.randomUUID(),
			eventType: 'purchase_granted',
			subjectId: claims.sub,
			purchasedName: `${name}-second`,
			occurredAt: new Date().toISOString()
		})
	})
	expect(secondEntitlement.status).toBe(201)
	let secondEnvironment: typeof environment | undefined
	const secondEnvironmentDeadline = Date.now() + 60_000
	while (Date.now() < secondEnvironmentDeadline) {
		const body = (await json(
			await fetch(`${api}/api/environments`, { headers: authorizedHeaders })
		)) as { environments: (typeof environment)[] }
		secondEnvironment = body.environments.find(
			(candidate) =>
				candidate.id !== environment.id &&
				candidate.observedState === 'ready' &&
				candidate.components.every((component) => component.observedState === 'ready')
		)
		if (secondEnvironment) break
		await new Promise((resolve) => setTimeout(resolve, 250))
	}
	if (!secondEnvironment) throw new Error('second customer environment did not reconcile')

	const intentBase = `${api}/api/environments/${environment.id}/intents`
	const targetIntentId = crypto.randomUUID()
	const sourceIntentId = crypto.randomUUID()
	for (const [id, title] of [
		[targetIntentId, 'Target conversation'],
		[sourceIntentId, 'Source conversation']
	] as const) {
		const response = await fetch(intentBase, {
			method: 'POST',
			headers: { ...authorizedHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({ id, title })
		})
		expect(response.status).toBe(201)
	}
	const secondIntentId = crypto.randomUUID()
	expect(
		(
			await fetch(`${api}/api/environments/${secondEnvironment.id}/intents`, {
				method: 'POST',
				headers: { ...authorizedHeaders, 'content-type': 'application/json' },
				body: JSON.stringify({ id: secondIntentId, title: 'Second customer only' })
			})
		).status
	).toBe(201)
	const firstList = (await json(await fetch(intentBase, { headers: authorizedHeaders }))) as {
		id: string
	}[]
	expect(firstList.map((intent) => intent.id)).not.toContain(secondIntentId)
	const contribution = {
		id: crypto.randomUUID(),
		contributorKind: 'human',
		kind: 'message',
		text: 'Persisted only in this customer database.',
		payload: { speaker: 'local-passkey-user' }
	}
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const response = await fetch(`${intentBase}/${targetIntentId}`, {
			method: 'POST',
			headers: { ...authorizedHeaders, 'content-type': 'application/json' },
			body: JSON.stringify(contribution)
		})
		expect(response.status).toBe(201)
	}
	const targetDetail = (await json(
		await fetch(`${intentBase}/${targetIntentId}`, { headers: authorizedHeaders })
	)) as { version: number; contributions: unknown[] }
	expect(targetDetail.contributions).toHaveLength(2)
	const sourceDetail = (await json(
		await fetch(`${intentBase}/${sourceIntentId}`, { headers: authorizedHeaders })
	)) as { version: number }
	const mergeCommand = {
		id: targetIntentId,
		commandId: crypto.randomUUID(),
		expectedVersion: targetDetail.version,
		sources: [{ id: sourceIntentId, expectedVersion: sourceDetail.version }]
	}
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const response = await fetch(`${intentBase}/${targetIntentId}/merge`, {
			method: 'POST',
			headers: { ...authorizedHeaders, 'content-type': 'application/json' },
			body: JSON.stringify(mergeCommand)
		})
		expect(response.status).toBe(200)
	}

	const actorBase = `${api}/api/environments/${environment.id}/actor-runs`
	const actorStart = await fetch(actorBase, {
		method: 'POST',
		headers: {
			...authorizedHeaders,
			'content-type': 'application/json',
			'x-aven-tenant-grant': 'forged-caller-grant'
		},
		body: JSON.stringify({
			protocol: ACTOR_RUN_PROTOCOL,
			requestId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
			requestedAt: new Date().toISOString(),
			skillRef: 'ceo.aven:skill:e2e:already-satisfied@1',
			executionEnvironment: 'server',
			ingredients: [{ predicate: 'ceo.aven.e2e.done(test)' }],
			goals: ['ceo.aven.e2e.done(test)'],
			parameters: {}
		})
	})
	expect(actorStart.status).toBe(202)
	const actorHandle = (await actorStart.json()) as { runId: string }
	let actorRecord: { state: string; security: { access: { tenantId?: string } } } | undefined
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const response = await fetch(`${actorBase}/${actorHandle.runId}`, {
			headers: authorizedHeaders
		})
		expect(response.status).toBe(200)
		actorRecord = await response.json()
		if (actorRecord.state === 'succeeded') break
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
	expect(actorRecord).toMatchObject({
		state: 'succeeded',
		security: { access: { tenantId: environment.id } }
	})

	const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 })
	try {
		const customerDatabase = databaseNameForEnvironment(environment.id)
		const secondCustomerDatabase = databaseNameForEnvironment(secondEnvironment.id)
		expect(secondCustomerDatabase).not.toBe(customerDatabase)
		const apiDatabase = new pg.Pool({
			connectionString: databaseUrl.replace(/\/postgres$/, '/aven_api'),
			max: 1
		})
		try {
			expect(
				(await apiDatabase.query("SELECT to_regnamespace('aven_intents') AS schema")).rows[0].schema
			).toBeNull()
		} finally {
			await apiDatabase.end()
		}
		const checkoutDatabase = new pg.Pool({
			connectionString: databaseUrl.replace(/\/postgres$/, '/aven_checkout'),
			max: 1
		})
		try {
			const delivery = (
				await checkoutDatabase.query(
					`SELECT event_type,payload,state,attempt_count
					 FROM polar_webhook_deliveries WHERE delivery_id=$1`,
					[ignoredDeliveryId]
				)
			).rows[0]
			expect(delivery).toEqual({
				event_type: 'future.feature.created',
				payload: JSON.parse(ignoredWebhookBody),
				state: 'processed',
				attempt_count: 1
			})
		} finally {
			await checkoutDatabase.end()
		}
		const customer = new pg.Pool({
			connectionString: databaseUrl.replace(/\/postgres$/, `/${customerDatabase}`),
			max: 1
		})
		try {
			expect(
				(await customer.query('SELECT count(*)::int AS count FROM aven_intents.intents')).rows[0]
					.count
			).toBe(3)
			expect(
				(
					await customer.query(
						`SELECT count(*)::int AS count FROM aven_intents.contributions
						 WHERE intent_id=$1 AND text = ANY($2::text[])`,
						[tauri.intentId, ['Hello from Tauri E2E', 'E2E chat reply.']]
					)
				).rows[0].count
			).toBe(2)
			expect(
				(
					await customer.query(
						`SELECT count(*)::int AS count FROM artifact_store.artifact_records
						 WHERE id = ANY($1::uuid[])`,
						[[tauri.sourceArtifactId, tauri.extractedTextArtifactId]]
					)
				).rows[0].count
			).toBe(2)
			expect(
				(await customer.query('SELECT count(*)::int AS count FROM aven_actor_runs.runs')).rows[0]
					.count
			).toBe(1)
			const intentRole = databaseRoleName(environment.id, 'int_api')
			const actorRole = databaseRoleName(environment.id, 'act_api')
			const artifactRole = databaseRoleName(environment.id, 'art_api')
			const privileges = (
				await customer.query(
					`SELECT has_table_privilege($1,'aven_intents.intents','SELECT') AS intent_read,
					 has_table_privilege($1,'aven_actor_runs.runs','SELECT') AS actor_read,
					 has_table_privilege($2,'aven_actor_runs.runs','SELECT') AS actor_own,
					 has_table_privilege($2,'aven_intents.intents','SELECT') AS intent_cross,
					 has_table_privilege($3,'artifact_store.artifact_records','SELECT') AS artifact_own,
					 has_table_privilege($3,'aven_intents.intents','SELECT') AS artifact_cross,
					 has_table_privilege($1,'artifact_store.artifact_records','SELECT') AS intent_artifact_cross`,
					[intentRole, actorRole, artifactRole]
				)
			).rows[0]
			expect(privileges).toEqual({
				intent_read: true,
				actor_read: false,
				actor_own: true,
				intent_cross: false,
				artifact_own: true,
				artifact_cross: false,
				intent_artifact_cross: false
			})
		} finally {
			await customer.end()
		}
		const secondCustomer = new pg.Pool({
			connectionString: databaseUrl.replace(/\/postgres$/, `/${secondCustomerDatabase}`),
			max: 1
		})
		try {
			expect(
				(await secondCustomer.query('SELECT count(*)::int AS count FROM aven_intents.intents'))
					.rows[0].count
			).toBe(1)
		} finally {
			await secondCustomer.end()
		}
		const crossDatabaseUrl = new URL(databaseUrl)
		crossDatabaseUrl.username = databaseRoleName(environment.id, 'int_api')
		crossDatabaseUrl.password = deriveDatabasePassword({
			root: 'intent-root-00000000000000000000000000000001',
			environmentId: environment.id,
			routingGeneration: environment.routingGeneration,
			roleKind: 'ceo.aven:db-role:intents:api@1'
		})
		crossDatabaseUrl.pathname = `/${secondCustomerDatabase}`
		const crossDatabase = new pg.Pool({ connectionString: crossDatabaseUrl.toString(), max: 1 })
		try {
			await expect(crossDatabase.query('SELECT 1')).rejects.toThrow(/permission denied/)
		} finally {
			await crossDatabase.end()
		}
	} finally {
		await admin.end()
	}

	const created = await fetch(`${api}/api/sites`, {
		method: 'POST',
		headers: { ...authorizedHeaders, 'content-type': 'application/json' },
		body: JSON.stringify({
			hostname: `${name}.example.test`,
			repository: 'myavenceo/aven-brands',
			sourceBranch: 'production',
			deploymentBranch: `deploy/${name}`
		})
	})
	if (created.status !== 201)
		throw new Error(`site creation failed: ${created.status} ${await created.text()}`)
	const createdSite = (await created.json()) as { site: { id: string }; dns: { txtName: string } }
	expect(createdSite.dns.txtName).toBe(`_aven-site.${name}.example.test`)
	await expect(
		(
			await fetch(`${api}/api/sites/${createdSite.site.id}`, {
				method: 'DELETE',
				headers: authorizedHeaders
			})
		).status
	).toBe(200)

	await expect(
		(
			await fetch(`${api}/internal/v1/static-sites/bindings`, {
				headers: { authorization: 'Bearer wrong' }
			})
		).status
	).toBe(404)
	const directory = (await json(
		await fetch(`${api}/internal/v1/static-sites/bindings`, {
			headers: { authorization: `Bearer ${directorySecret}` }
		})
	)) as { bindings: { hostname: string; verification_mode: string; owner_is_admin: boolean }[] }
	expect(directory.bindings).toContainEqual(
		expect.objectContaining({
			hostname: 'aven.ceo',
			verification_mode: 'operator',
			owner_is_admin: true
		})
	)

	const staticDeadline = Date.now() + 90_000
	let hosted: Awaited<ReturnType<typeof hostedDocument>> | null = null
	while (Date.now() < staticDeadline) {
		hosted = await hostedDocument(staticHost, 'aven.ceo')
		if (hosted.ok) break
		await new Promise((resolve) => setTimeout(resolve, 1_000))
	}
	if (!hosted?.ok) throw new Error(`aven.ceo snapshot was not served (${hosted?.status})`)
	expect(hosted.text.toLowerCase()).toContain('aven')

	const secondProvision = await fetch(`${identity}/internal/v1/accounts`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${provisioningSecret}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({ email, source: 'e2e-idempotence' })
	})
	await expect(secondProvision.status).toBe(200)
	await expect((await secondProvision.json()).setupUrl).toBeNull()

	await secondContext.close()
	await context.close()
})
