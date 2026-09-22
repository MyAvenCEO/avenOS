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
	invocationStatus: 'not-evaluated'
}

const browser = await chromium.launch({ headless: true })
let page
try {
	page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
	page.setDefaultTimeout(12000)
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.goto((process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1420') + '/dashboard')
	await page.getByRole('button', { name: 'Skills', exact: true }).waitFor({ timeout: 60000 })
	await page.evaluate(
		({ definition, operation }) => {
			const id = () => crypto.randomUUID()
			// PostgreSQL/Rust Store returns canonical object ordering, unlike the authored editor value.
			const stored = (value) =>
				JSON.parse(
					JSON.stringify(value, (_key, item) =>
						item && typeof item === 'object' && !Array.isArray(item)
							? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
							: item
					)
				)
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
					if (op === 'case-propose' || op === 'case-confirm') {
						const original = state.artifacts.find((a) => a.artifactId === data.artifactId)
						const artifact = {
							artifactId: id(),
							typeKey: 'studio.case',
							typeVersion: 1,
							committedAt: new Date().toISOString(),
							payload: {
								case: stored(op === 'case-confirm' ? original.payload.case : data.case),
								status: op === 'case-confirm' ? 'confirmed' : 'proposed',
								predecessorArtifactId: data.artifactId ?? data.predecessorArtifactId ?? null,
								recordedBy: state.subjectId
							}
						}
						state.artifacts.unshift(artifact)
						return structuredClone(artifact)
					}
					if (op === 'case-what-if') {
						const c = state.artifacts.find((a) => a.artifactId === data.artifactId).payload.case
						return {
							gaps: c.steps.filter((s) => s.kind === 'ideal').length,
							steps: c.steps.map((s) => ({
								...s,
								status: s.kind === 'ideal' ? 'needs-implementation' : 'not-executed'
							}))
						}
					}
					if (op === 'case-build') {
						const c = state.artifacts.find((a) => a.artifactId === data.artifactId)
						if (
							c.payload.status !== 'confirmed' ||
							c.payload.case.steps.some((s) => s.kind === 'ideal')
						)
							throw Error('CASE_NOT_READY')
						const draft = {
							id: id(),
							revision: 1,
							subjectId: state.subjectId,
							definition: {
								...structuredClone(definition),
								name: c.payload.case.title,
								caseArtifactId: c.artifactId
							},
							publishedArtifactId: null,
							publishedRevision: null,
							updatedAt: new Date().toISOString()
						}
						state.drafts.push(draft)
						return structuredClone(draft)
					}
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
							opportunities: window.studioFixture.noRoute
								? []
								: [
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
	await page.locator('details[data-category="email"] > summary').waitFor()
	assert.equal(await page.getByRole('heading', { name: operation.label }).isVisible(), false)
	await page.locator('details[data-category="email"] > summary').focus()
	await page.keyboard.press('Space')
	await page.locator('details[data-category="email"] details.actor-branch > summary').click()
	await page.getByRole('heading', { name: operation.label }).waitFor()
	assert.equal(await page.getByRole('button', { name: /Add to Skill/ }).count(), 1)
	await page.getByRole('button', { name: /Can add to Skill/ }).click()
	await page.getByRole('textbox', { name: 'Find an operation' }).fill('email brief')
	await page.getByRole('heading', { name: operation.label }).waitFor()
	await page.getByRole('textbox', { name: 'Find an operation' }).fill('no matching action')
	await page.getByText('No actions match this search.').waitFor()
	await page.getByRole('button', { name: 'Clear search', exact: true }).click()
	await page.getByRole('button', { name: /All actions/ }).click()
	await page.screenshot({ path: '/tmp/aven-studio-categories.png', fullPage: true })
	await page.locator('details[data-category="email"] > summary').click()
	await page.screenshot({ path: '/tmp/aven-studio-categories-collapsed.png', fullPage: true })
	await page.getByRole('button', { name: 'Start conversation', exact: true }).click()
	await page.getByRole('textbox', { name: 'Message Aven' }).waitFor()
	assert.equal(
		await page.locator('dialog.operations[open]').count(),
		1,
		'chat must not close the working context'
	)
	await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
	await page.setViewportSize({ width: 390, height: 844 })
	await page.getByRole('textbox', { name: 'Find an operation' }).fill('email')
	await page.getByRole('heading', { name: operation.label }).waitFor()
	assert.equal(
		await page
			.locator('dialog.operations[open]')
			.evaluate((element) => element.scrollWidth <= element.clientWidth),
		true
	)
	await page.screenshot({ path: '/tmp/aven-studio-categories-narrow.png', fullPage: true })
	await page.setViewportSize({ width: 1280, height: 800 })
	await page.getByRole('button', { name: 'Close operations' }).click()

	await page.getByRole('button', { name: /Try a sample email/ }).click()
	await page.getByRole('heading', { name: 'What could this become?' }).waitFor()
	await page.evaluate(() => {
		const first = window.studioFixture.state.artifacts.find((a) => a.typeKey === 'studio.email')
		window.studioFixture.state.artifacts.push({
			...structuredClone(first),
			artifactId: crypto.randomUUID(),
			committedAt: '2026-08-01T09:00:00Z',
			payload: { ...first.payload, from: 'duplicate@example.test' }
		})
	})
	await page.getByRole('button', { name: 'Refresh', exact: true }).click()
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
	await page.getByRole('button', { name: 'Input email', exact: true }).click()
	const picker = page.getByRole('dialog', { name: 'Choose email' })
	assert.equal(await picker.locator('.results button').count(), 2)
	await picker.getByRole('textbox', { name: 'Find email' }).fill('duplicate@example.test')
	assert.equal(await picker.locator('.results button').count(), 1)
	await picker.getByRole('textbox', { name: 'Find email' }).press('Escape')
	assert.equal(await picker.count(), 0)
	await page.waitForFunction(
		() => document.activeElement?.getAttribute('aria-label') === 'Input email'
	)
	assert.equal(
		await page
			.getByRole('button', { name: 'Input email', exact: true })
			.evaluate((e) => document.activeElement === e),
		true
	)
	await page.screenshot({ path: '/tmp/aven-studio-compose-v2.png', fullPage: true })
	const publishButton = page.getByRole('button', { name: 'Publish Skill', exact: true })
	await page.getByText('Ready to publish').waitFor()
	assert.equal(await publishButton.isEnabled(), true, 'publish button must be enabled')
	await publishButton.click()
	await page.waitForTimeout(500)
	if (!(await page.getByText('Immutable Skill published.').count()))
		throw new Error(
			`Publish failed. Browser errors: ${errors.join(' | ')}\n${await page.locator('body').innerText()}\n${JSON.stringify(await page.evaluate(() => window.studioFixture.calls.slice(-5)))}`
		)
	await page.getByText('Immutable Skill published.').waitFor()
	// An already-open saved revision must notice publication by the agent/another
	// surface. Reproduce the earlier metadata snapshot without changing its revision.
	await page.evaluate(() => {
		const draft = window.studioFixture.state.drafts[0]
		window.savedStudioPublication = {
			publishedArtifactId: draft.publishedArtifactId,
			publishedRevision: draft.publishedRevision
		}
		draft.publishedArtifactId = null
		draft.publishedRevision = null
	})
	await page.getByRole('button', { name: 'Refresh', exact: true }).click()
	await page.locator('aside button.draft').filter({ hasText: 'My email Skill' }).click()
	await page.getByText('Publish first', { exact: true }).waitFor()
	await page.evaluate(() =>
		Object.assign(window.studioFixture.state.drafts[0], window.savedStudioPublication)
	)
	await page.getByRole('button', { name: 'Refresh', exact: true }).click()
	await page.getByText('Published revision', { exact: true }).waitFor()
	await page.getByRole('combobox', { name: 'Setting tone' }).selectOption('concise')
	await page.getByRole('button', { name: 'Input email', exact: true }).click()
	await page
		.getByRole('dialog', { name: 'Choose email' })
		.locator('.results button')
		.filter({ hasText: 'finance@example.test' })
		.click()
	await page.getByRole('textbox', { name: 'Skill name' }).fill('Unsaved local change')
	await page.getByRole('textbox', { name: 'Skill name' }).press('Tab')
	assert.equal(await page.getByRole('button', { name: /Run Skill/ }).isDisabled(), true)
	await page.getByRole('textbox', { name: 'Skill name' }).fill('My email Skill')
	await page.getByRole('textbox', { name: 'Skill name' }).press('Tab')
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
	if (!(await page.locator('details.reuse').count()))
		throw new Error(
			`Reusable Skills missing. ${JSON.stringify(await page.evaluate(() => window.studioFixture.state.skills))}\n${await page.locator('body').innerText()}`
		)
	await page.locator('details.reuse > summary').click()
	await page
		.locator('details.reuse')
		.getByRole('button', { name: /My email Skill/ })
		.click()
	await page.getByText('Exact nested Skill').waitFor()
	const nestedDetails = page.locator('.steps > article > details.step-details').first()
	assert.equal(await nestedDetails.getAttribute('open'), null, 'nested details start collapsed')
	await nestedDetails.locator(':scope > summary').click()
	await nestedDetails.getByRole('button', { name: 'Look inside this skill' }).click()
	await nestedDetails.getByRole('region', { name: 'Inside My email Skill' }).waitFor()
	await nestedDetails.getByText('1. Create email brief', { exact: true }).waitFor()
	await page.screenshot({ path: '/tmp/aven-studio-nested-inspection.png', fullPage: true })
	await page.setViewportSize({ width: 390, height: 844 })
	assert(
		await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		'expanded nested skill must fit on a narrow screen'
	)
	await page.setViewportSize({ width: 1280, height: 800 })
	await nestedDetails.locator(':scope > summary').click()
	await page.locator('details.advanced').click()
	await page.getByRole('textbox', { name: 'Skill definition JSON' }).waitFor()
	await page.screenshot({ path: '/tmp/aven-studio-nested-v2.png', fullPage: true })
	await page.evaluate(() => {
		window.studioFixture.noRoute = true
	})
	await page
		.locator('.artifact-list')
		.getByRole('button', { name: /Quarterly review Email/ })
		.first()
		.click()
	await page.getByRole('heading', { name: "Let's find the next step." }).waitFor()
	await page.getByRole('button', { name: 'Browse actions', exact: true }).click()
	await page.getByRole('dialog', { name: 'Studio operations' }).waitFor()
	await page.getByRole('button', { name: 'Start conversation', exact: true }).click()
	await page.getByRole('textbox', { name: 'Message Aven' }).waitFor()
	assert.equal(await page.getByRole('dialog', { name: 'Studio operations' }).isVisible(), true)
	assert.equal(
		await page.evaluate(async () => {
			const { screenContext } = await import('/src/lib/chat/screen-context.svelte.ts')
			return screenContext.overlay?.kind
		}),
		'operation-catalog'
	)
	await page.getByRole('button', { name: 'Close conversation' }).click()
	await page.getByRole('button', { name: 'Close operations' }).click()
	await page.getByRole('button', { name: 'Inspect item', exact: true }).click()
	await page.getByRole('dialog', { name: 'Artifact provenance' }).waitFor()

	await page
		.getByRole('dialog', { name: 'Artifact provenance' })
		.getByRole('button', { name: '✕' })
		.click()
	await page.getByRole('button', { name: /Real cases/ }).click()
	await page.locator('body').click({ position: { x: 1100, y: 150 } })
	await page.keyboard.type('Help')
	assert.equal(await page.getByRole('textbox', { name: 'Message Aven' }).inputValue(), 'Help')
	assert.equal(
		await page
			.getByRole('textbox', { name: 'Message Aven' })
			.evaluate((e) => e === document.activeElement),
		true
	)
	await page.getByRole('button', { name: 'Close conversation' }).click()
	await page.getByRole('textbox', { name: 'Case name', exact: true }).fill('Weekly project case')
	await page.getByRole('textbox', { name: 'Case situation' }).fill('Project update email arrived')
	await page.getByRole('textbox', { name: 'Case outcome' }).fill('A brief with the key deadline')
	await page.getByRole('button', { name: /Describe what I remember/ }).click()
	await page
		.getByRole('textbox', { name: 'Evidence text' })
		.fill('I read the email and wrote down the deadline.')
	await page.getByRole('button', { name: /Missing step/ }).click()
	await page
		.getByRole('textbox', { name: 'Ideal step acceptance' })
		.fill('The brief includes the original deadline')
	assert.equal(await page.getByRole('button', { name: /Build Skill/ }).isEnabled(), false)
	await page.getByRole('button', { name: 'What if…', exact: true }).click()
	await page.getByText('What if · nothing executed').waitFor()
	await page.getByRole('button', { name: 'Yes, this is the case', exact: true }).click()
	await page.getByText('✓ Confirmed case', { exact: true }).waitFor()
	assert.equal(await page.getByRole('button', { name: /Build Skill/ }).isEnabled(), false)
	await page.screenshot({ path: '/tmp/aven-studio-case-what-if.png', fullPage: true })
	await page.getByRole('button', { name: /Replace with an existing action/ }).click()
	await page.getByRole('textbox', { name: 'Find an operation' }).fill('email brief')
	await page.getByRole('button', { name: /Add to Skill/ }).click()
	assert.equal(
		await page.getByRole('button', { name: /Build Skill/ }).isEnabled(),
		false,
		'editing invalidates confirmation'
	)
	await page.getByRole('button', { name: 'Yes, this is the case', exact: true }).click()
	await page.getByText('✓ Confirmed case', { exact: true }).waitFor()
	await page.getByRole('button', { name: /Build Skill/ }).click()
	await page.getByRole('textbox', { name: 'Skill name' }).waitFor()
	assert.equal(
		await page.getByRole('textbox', { name: 'Skill name' }).inputValue(),
		'Weekly project case'
	)
	await page.getByRole('button', { name: /Original case/ }).waitFor()
	await page.getByRole('button', { name: /Real cases/ }).click()
	await page.setViewportSize({ width: 390, height: 844 })
	assert.equal(
		await page.locator('.case-studio').evaluate((e) => e.scrollWidth <= e.clientWidth),
		true
	)
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		true,
		'the full page must fit a narrow screen'
	)
	await page.screenshot({ path: '/tmp/aven-studio-case-narrow.png', fullPage: true })
	await page.evaluate(async () => {
		const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
		chatActor.core.turns.push({
			id: crypto.randomUUID(),
			role: 'assistant',
			content: 'Your case stays open while we work.'
		})
	})
	await page.getByText('Your case stays open while we work.', { exact: true }).waitFor()
	assert.equal(await page.locator('.case-studio').isVisible(), true)
	await page.evaluate(async () => {
		const { shell } = await import('/src/lib/intents/talk.svelte.ts')
		shell.tab = 'intents'
	})
	await page.locator('.case-studio').waitFor({ state: 'detached' })
	await page.evaluate(async () => {
		const { bus } = await import('/src/lib/actors/bus.ts')
		const savedCase = window.studioFixture.state.artifacts.find((a) => a.typeKey === 'studio.case')
		await bus.dispatch('agent', 'studio_case_propose', {
			case: { ...savedCase.payload.case, title: 'Case proposed from chat' }
		})
	})
	await page.getByRole('button', { name: 'Review selected case →' }).click()
	assert.equal(
		await page.getByRole('textbox', { name: 'Case name', exact: true }).inputValue(),
		'Case proposed from chat'
	)
	const calls = await page.evaluate(() => window.studioFixture.calls)
	assert(
		calls.some((call) => call.operation === 'start' && call.data.parameters.tone === 'concise')
	)
	assert(calls.some((call) => call.operation === 'connect' && call.data.skillArtifactId))
	assert.deepEqual(errors, [])
	console.log(
		'Studio UI: discovery, execution, connections, nesting, case confirmation, ideal what-if, revision and case-to-Skill passed.'
	)
} catch (error) {
	if (page) {
		await page.screenshot({ path: '/tmp/aven-studio-ui-failure.png', fullPage: true })
		console.error(await page.locator('body').innerText())
	}
	throw error
} finally {
	await browser.close()
}
