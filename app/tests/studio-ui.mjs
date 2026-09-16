// Real Svelte Studio. Only the authenticated native boundary is simulated.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const emailPort = {
	schema: 'ceo.aven:schema:studio:email@1',
	type: { key: 'studio.email', version: 1 },
	predicate: 'ceo.aven.studio.email(E)',
	role: 'source',
	cardinality: 'one'
}
const briefPort = {
	schema: 'ceo.aven:schema:studio:brief@1',
	type: { key: 'studio.brief', version: 1 },
	predicate: 'ceo.aven.studio.brief(E)',
	role: 'result',
	cardinality: 'one'
}
const definition = {
	version: 2,
	name: 'Brief incoming email',
	inputs: { email: emailPort },
	parametersSchema: {
		type: 'object',
		properties: { tone: { type: 'string', maxLength: 16, enum: ['concise', 'detailed'] } },
		required: ['tone'],
		additionalProperties: false,
		maxProperties: 1
	},
	steps: [
		{
			id: 'create',
			kind: 'invoke',
			label: 'Create email brief',
			capabilityId: 'ceo.aven:capability:studio.email-brief:create@1',
			inputs: { email: { kind: 'input', port: 'email' } },
			parameters: { tone: { kind: 'parameter', name: 'tone' } },
			outputs: { brief: briefPort }
		}
	],
	outputs: { brief: { ...briefPort, from: { kind: 'step', stepId: 'create', port: 'brief' } } },
	policy: {
		maxInvocations: 16,
		maxDepth: 4,
		maxMembers: 64,
		maxConcurrentChildren: 2,
		allowModel: false
	}
}
const operation = {
	actorId: 'ceo.aven:actor:studio:email-brief@1',
	capabilityId: 'ceo.aven:capability:studio.email-brief:create@1',
	version: '1',
	installationDigest: 'a'.repeat(64),
	label: 'Email brief · create',
	description: 'Turn a committed email into a concise brief.',
	tags: ['email'],
	mode: 'transform',
	parametersSchema: definition.parametersSchema,
	inputs: [{ name: 'email', ...emailPort, sensitive: false }],
	outputs: [{ name: 'brief', ...briefPort, sensitive: false }],
	requires: [emailPort.predicate],
	produces: [briefPort.predicate],
	placements: ['server'],
	readiness: 'needs-input',
	reasonCodes: [],
	canAuthor: true,
	canPlan: true,
	canInvokeNow: false
}

const browser = await chromium.launch({ headless: true })
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
	page.setDefaultTimeout(12000)
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.goto((process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1449') + '/dashboard')
	await page.getByRole('button', { name: 'Skills', exact: true }).waitFor()
	await page.evaluate(
		({ definition, operation }) => {
			const id = () => crypto.randomUUID()
			const state = {
				scopeId: id(),
				subjectId: id(),
				drafts: [],
				connections: [],
				runs: [],
				files: [],
				skills: [],
				sources: [],
				artifacts: [],
				deliveries: [],
				dispatchMode: 'authorized-session'
			}
			window.studioFixture = { state, calls: [] }
			window.isTauri = true
			window.__TAURI_INTERNALS__ = {
				invoke: async (command, args) => {
					if (command !== 'studio_request') return null
					const { operation: op, data } = args.command
					window.studioFixture.calls.push(structuredClone(args.command))
					if (op === 'state') return structuredClone(state)
					if (op === 'sync') {
						for (const connection of state.connections.filter((item) => item.enabled)) {
							const arrivals = state.artifacts
								.slice(connection.after)
								.filter((item) => item.typeKey === 'studio.email')
							connection.after = state.artifacts.length
							for (const email of arrivals) {
								window.studioFixture.calls.push({
									operation: 'start',
									data: { source: 'subscription', email: email.artifactId }
								})
								const output = {
									artifactId: id(),
									typeKey: 'studio.brief',
									typeVersion: 1,
									payload: {
										title: email.payload.subject,
										summary: `Email from ${email.payload.from}: ${email.payload.subject}`,
										status: 'complete'
									},
									committedAt: new Date().toISOString()
								}
								state.artifacts.push(output)
								state.runs.push({
									runId: id(),
									state: 'succeeded',
									createdAt: new Date().toISOString(),
									checkpoints: [{ output: { artifact: output } }]
								})
							}
						}
						return { queued: 0, dispatchMode: 'authorized-session' }
					}
					if (op === 'catalog') {
						const match =
							!data.search ||
							`${operation.label} ${operation.capabilityId}`
								.toLowerCase()
								.includes(data.search.toLowerCase())
						const entries =
							match && (!data.readyOnly || operation.readiness === 'ready') ? [operation] : []
						return {
							contractVersion: 1,
							catalogDigest: 'fixture-contract',
							authorityContext: 'fixture-authority',
							viewToken: id(),
							capturedAt: new Date().toISOString(),
							expiresAt: new Date(Date.now() + 300000).toISOString(),
							actors: [
								{
									actorId: operation.actorId,
									version: '1',
									label: 'Email brief',
									description: operation.description,
									tags: ['email'],
									placements: ['server'],
									visibleOperationCount: 1,
									kind: 'operations',
									canCompose: true
								}
							],
							actorVisibleCount: 1,
							entries,
							visibleCount: entries.length,
							totalVisibleCount: match ? 1 : 0,
							readyVisibleCount: 0,
							nextCursor: null
						}
					}
					if (op === 'sample') {
						const source = {
							artifactId: id(),
							typeKey: 'studio.source',
							typeVersion: 1,
							payload: { name: 'Sample mailbox' },
							committedAt: new Date().toISOString()
						}
						const email = {
							artifactId: id(),
							typeKey: 'studio.email',
							typeVersion: 1,
							payload: { subject: 'Quarterly review', from: 'finance@example.test' },
							committedAt: new Date().toISOString()
						}
						state.sources.push(source)
						state.artifacts.push(email)
						return { source, artifacts: [email] }
					}
					if (op === 'explore')
						return {
							source: state.artifacts.find((item) => item.artifactId === data.artifactId),
							opportunities: [
								{
									label: definition.name,
									definition,
									conditional: false,
									steps: definition.steps.map(({ id, label }) => ({ id, label }))
								}
							],
							next: 'Choose an outcome.'
						}
					if (op === 'preview')
						return {
							ok: true,
							mode: 'authoring-contract',
							publishes: false,
							definitionDigest: 'b'.repeat(64),
							transitiveChildArtifactIds: [],
							issues: []
						}
					if (op === 'draft') {
						let draft = state.drafts.find((item) => item.id === data.id)
						if (draft && draft.revision !== data.revision) throw new Error('STUDIO_DRAFT_CONFLICT')
						if (!draft) {
							draft = {
								id: data.id,
								subjectId: state.subjectId,
								revision: 0,
								publishedArtifactId: null,
								publishedRevision: null
							}
							state.drafts.push(draft)
						}
						draft.definition = structuredClone(data.definition)
						draft.revision++
						draft.updatedAt = new Date().toISOString()
						return structuredClone(draft)
					}
					if (op === 'publish') {
						const draft = state.drafts.find((item) => item.id === data.id)
						const artifact = {
							artifactId: id(),
							typeKey: 'studio.skill',
							typeVersion: 2,
							payload: structuredClone(draft.definition),
							committedAt: new Date().toISOString()
						}
						draft.publishedArtifactId = artifact.artifactId
						draft.publishedRevision = draft.revision
						state.skills.push(artifact)
						state.artifacts.push(artifact)
						return { draft: structuredClone(draft), artifact: structuredClone(artifact) }
					}
					if (op === 'start') {
						const output = {
							artifactId: id(),
							typeKey: 'studio.brief',
							typeVersion: 1,
							payload: {
								title: 'Quarterly review',
								summary: 'Email from finance@example.test: Quarterly review',
								status: 'complete'
							},
							committedAt: new Date().toISOString()
						}
						state.artifacts.push(output)
						const run = {
							runId: id(),
							state: 'succeeded',
							createdAt: new Date().toISOString(),
							checkpoints: [{ output: { artifact: output } }]
						}
						state.runs.push(run)
						return run
					}
					if (op === 'connect') {
						state.connections.push({
							id: data.id,
							revision: 1,
							enabled: true,
							last_error: null,
							after: state.artifacts.length,
							record: { ...data, inputType: { key: 'studio.email', version: 1 } }
						})
						return { id: data.id }
					}
					if (op === 'control') {
						const connection = state.connections.find((item) => item.id === data.id)
						connection.enabled = data.enabled
						connection.revision++
						return structuredClone(connection)
					}
					if (op === 'inspect')
						return {
							artifact: state.artifacts.find((item) => item.artifactId === data.artifactId),
							inputs: state.artifacts
								.filter((item) => item.typeKey === 'studio.email')
								.slice(0, 1)
								.map((item) => ({ role: 'source', artifactId: item.artifactId }))
						}
					throw new Error(`Unknown Studio operation ${op}`)
				}
			}
		},
		{ definition, operation }
	)

	await page.getByRole('button', { name: 'Skills', exact: true }).click()
	await page.getByRole('button', { name: 'Operations' }).click()
	await page.getByRole('dialog', { name: 'Studio operations' }).waitFor()
	await page.getByRole('button', { name: /All permitted/ }).click()
	await page.getByRole('heading', { name: operation.label }).waitFor()
	assert.equal(await page.getByRole('button', { name: /Add to Skill/ }).count(), 1)
	await page.getByRole('button', { name: 'Close operations' }).click()

	await page.getByRole('button', { name: /Try a sample email/ }).click()
	await page.getByRole('heading', { name: 'What could this become?' }).waitFor()
	await page.getByRole('heading', { name: definition.name }).click()
	await page.waitForTimeout(300)
	if (!(await page.getByRole('textbox', { name: 'Skill name' }).count()))
		throw new Error(
			`Compose did not open. Browser errors: ${errors.join(' | ')}\n${await page.locator('body').innerText()}`
		)
	await page.getByRole('textbox', { name: 'Skill name' }).fill('My email Skill')
	await page.getByRole('textbox', { name: 'Skill name' }).press('Tab')
	await page.getByText('Ready to publish').waitFor()
	await page.getByRole('combobox', { name: 'Setting tone' }).selectOption('concise')
	await page.screenshot({ path: '/tmp/aven-studio-compose-v2.png', fullPage: true })
	const publishButton = page.getByRole('button', { name: 'Publish Skill', exact: true })
	assert.equal(await publishButton.isEnabled(), true, 'publish button must be enabled')
	await publishButton.dispatchEvent('click')
	await page.waitForTimeout(500)
	if (!(await page.getByText('Immutable Skill published.').count()))
		throw new Error(
			`Publish failed. Browser errors: ${errors.join(' | ')}\n${await page.locator('body').innerText()}\n${JSON.stringify(await page.evaluate(() => window.studioFixture.calls.slice(-5)))}`
		)
	await page.getByText('Immutable Skill published.').waitFor()
	await page.getByRole('button', { name: /Run Skill/ }).click()
	await page.getByText('Email from finance@example.test: Quarterly review').waitFor()
	await page.getByRole('button', { name: /Trace/ }).click()
	await page.getByRole('dialog', { name: 'Artifact provenance' }).waitFor()
	await page.getByRole('button', { name: /source/ }).waitFor()
	await page
		.getByRole('dialog', { name: 'Artifact provenance' })
		.getByRole('button', { name: '✕' })
		.click()

	await page.getByRole('button', { name: /Compose/ }).click()
	await page.getByRole('button', { name: 'Connect arrivals', exact: true }).click()
	await page.getByRole('button', { name: /Enable connection/ }).click()
	await page.getByRole('button', { name: 'Pause', exact: true }).click()
	await page.getByRole('button', { name: 'Resume', exact: true }).click()
	await page.evaluate(() => {
		window.studioFixture.state.artifacts.push({
			artifactId: crypto.randomUUID(),
			typeKey: 'studio.email',
			typeVersion: 1,
			payload: { subject: 'Automatic arrival', from: 'new@example.test' },
			committedAt: new Date().toISOString()
		})
	})
	await page.getByText('Email from new@example.test: Automatic arrival').waitFor({ timeout: 15000 })
	assert(
		await page.evaluate(() =>
			window.studioFixture.calls.some(
				(call) => call.operation === 'start' && call.data.source === 'subscription'
			)
		),
		'visible authenticated Studio must synchronize an ordinary arrival without Sample or manual Sync'
	)

	await page.getByRole('button', { name: /Compose/ }).click()
	await page.getByRole('button', { name: /New Skill/ }).click()
	await page.getByRole('button', { name: 'Close operations' }).click()
	await page.waitForTimeout(300)
	if (!(await page.locator('section.reuse').count()))
		throw new Error(
			`Reusable Skills missing. ${JSON.stringify(await page.evaluate(() => window.studioFixture.state.skills))}\n${await page.locator('body').innerText()}`
		)
	await page
		.locator('section.reuse')
		.getByRole('button', { name: /My email Skill/ })
		.click()
	await page.getByText('Exact nested Skill').waitFor()
	await page.locator('details.advanced').click()
	await page.getByRole('textbox', { name: 'Skill definition JSON' }).waitFor()
	await page.screenshot({ path: '/tmp/aven-studio-nested-v2.png', fullPage: true })

	const calls = await page.evaluate(() => window.studioFixture.calls)
	assert(
		calls.some((call) => call.operation === 'start' && call.data.parameters.tone === 'concise')
	)
	assert(calls.some((call) => call.operation === 'connect' && call.data.skillArtifactId))
	assert.deepEqual(errors, [])
	console.log(
		'Studio UI v2: discover, compose, parameterize, publish, execute, trace, connect, and nest passed.'
	)
} finally {
	await browser.close()
}
