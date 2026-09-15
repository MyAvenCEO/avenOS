// The real Svelte screen and compiler; only the native IPC boundary is simulated.
// Durable execution and delivery are covered by studio.persistence.e2e.test.ts.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { compileStudio, draftFor } from '../../libs/aven-actors/src/studio/index.ts'

const fileType = { key: 'core.file', version: 1 }
const understandingType = { key: 'studio.understanding', version: 1 }
const briefType = { key: 'studio.brief', version: 1 }
const definitions = [
	draftFor(fileType, understandingType, 'Understand document'),
	draftFor(fileType, briefType, 'Prepare a brief')
]
const browser = await chromium.launch({ headless: true })
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
	page.setDefaultTimeout(10000)
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.exposeFunction('studioCompileFixture', (definition) => {
		try {
			return { ok: true, program: compileStudio(definition) }
		} catch (error) {
			return { ok: false, issues: error.issues }
		}
	})
	await page.goto((process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1449') + '/dashboard')
	await page.getByRole('button', { name: 'Skills', exact: true }).waitFor()
	await page.evaluate((definitions) => {
		const id = () => crypto.randomUUID()
		const state = {
			drafts: [],
			connections: [],
			runs: [],
			files: [],
			skills: [],
			sources: [],
			artifacts: [],
			deliveries: [],
			catalog: [],
			dispatchMode: 'authorized-session'
		}
		window.studioFixture = { state, calls: [] }
		window.isTauri = true
		window.__TAURI_INTERNALS__ = {
			invoke: async (command, args) => {
				if (command !== 'studio_request') return null
				const { operation, data } = args.command
				window.studioFixture.calls.push(structuredClone(args.command))
				if (operation === 'state') return structuredClone(state)
				if (operation === 'sample') {
					const source = {
						artifactId: id(),
						typeKey: 'studio.source',
						typeVersion: 1,
						payload: { name: 'Sample mailbox' }
					}
					const file = {
						artifactId: id(),
						typeKey: 'core.file',
						typeVersion: 1,
						payload: { originalName: 'project-update.txt' },
						committedAt: new Date().toISOString()
					}
					state.files.push(file)
					state.artifacts.push(file)
					state.sources.push(source)
					return { source, artifacts: [file] }
				}
				if (operation === 'explore') {
					const source = state.artifacts.find((a) => a.artifactId === data.artifactId)
					return {
						source,
						opportunities:
							source.typeKey === 'core.file'
								? await Promise.all(
										definitions.map(async (definition) => ({
											label: definition.name,
											definition,
											conditional: true,
											steps: (await window.studioCompileFixture(definition)).program.steps[0]
												.capabilities
										}))
									)
								: [],
						next: 'Choose an outcome.'
					}
				}
				if (operation === 'preview') return window.studioCompileFixture(data.definition)
				if (operation === 'compare')
					return {
						baseline: await window.studioCompileFixture(data.baseline),
						variants: await Promise.all(data.variants.map(window.studioCompileFixture))
					}
				if (operation === 'draft') {
					let d = state.drafts.find((d) => d.id === data.id)
					if (d && d.revision !== data.revision)
						throw new Error('Draft conflict. Refresh before continuing.')
					if (!d) {
						d = { id: data.id, revision: 0 }
						state.drafts.push(d)
					}
					d.definition = structuredClone(data.definition)
					d.revision++
					return structuredClone(d)
				}
				if (operation === 'publish') {
					const d = state.drafts.find((d) => d.id === data.id)
					d.published_artifact_id = id()
					d.published_revision = d.revision
					const a = {
						artifactId: d.published_artifact_id,
						typeKey: 'studio.skill',
						typeVersion: 1,
						payload: structuredClone(d.definition)
					}
					state.skills.push(a)
					state.artifacts.push(a)
					return structuredClone(d)
				}
				if (operation === 'start') {
					const output = {
						artifactId: id(),
						typeKey: 'studio.brief',
						typeVersion: 1,
						payload: {
							title: 'Document brief',
							summary: 'Review the design on Thursday.',
							status: 'partial'
						}
					}
					state.artifacts.push(output)
					state.runs.push({
						runId: id(),
						state: 'succeeded',
						createdAt: new Date().toISOString(),
						checkpoints: [{ output: { artifact: output } }]
					})
					return state.runs.at(-1)
				}
				if (operation === 'connect') {
					state.connections.push({
						id: data.id,
						revision: 1,
						enabled: true,
						record: { ...data, inputType: { key: 'core.file', version: 1 } }
					})
					return { id: data.id }
				}
				if (operation === 'control') {
					const c = state.connections.find((c) => c.id === data.id)
					c.enabled = data.enabled
					c.revision++
					return structuredClone(c)
				}
				if (operation === 'sync') return { queued: 0 }
				if (operation === 'inspect')
					return {
						artifact: state.artifacts.find((a) => a.artifactId === data.artifactId),
						inputs: [{ role: 'source', artifactId: state.files[0].artifactId }]
					}
				throw new Error('Unknown operation ' + operation)
			}
		}
	}, definitions)
	await page.getByRole('button', { name: 'Skills', exact: true }).click()
	await page.getByRole('button', { name: 'Try a sample email' }).click()
	await page.getByRole('heading', { name: 'What could this become?' }).waitFor()
	await page.screenshot({ path: '/tmp/aven-studio-explore.png', fullPage: true })
	await page
		.locator('.opportunity')
		.filter({ has: page.getByRole('heading', { name: 'Understand document' }) })
		.click()
	await page.getByRole('textbox', { name: 'Program name' }).fill('My document Skill')
	await page.getByRole('button', { name: 'Lock route' }).click()
	assert.equal(await page.locator('.open-goal').count(), 0)
	await page.getByRole('button', { name: '＋ Prepare a brief', exact: true }).click()
	await page.locator('.what-if summary').click()
	await page.getByRole('spinbutton').fill('1')
	await page.getByRole('button', { name: 'Compare', exact: true }).click()
	await page.getByText('Over budget', { exact: true }).waitFor()
	const before = await page.evaluate(
		() =>
			window.studioFixture.calls.filter((c) =>
				['start', 'publish', 'connect'].includes(c.operation)
			).length
	)
	assert.equal(before, 0, 'what-if cannot publish or execute')
	await page.getByText('Ready to publish', { exact: false }).waitFor()
	await page.locator('.canvas').evaluate((el) => (el.scrollTop = 0))
	await page.screenshot({ path: '/tmp/aven-studio-compose.png', fullPage: true })
	await page.getByRole('button', { name: 'Publish Skill', exact: true }).click()
	await page.getByText('Skill published · exact revision saved', { exact: false }).waitFor()
	await page.getByRole('button', { name: 'Connect to arrivals', exact: true }).click()
	await page.getByRole('button', { name: 'Enable connection' }).click()
	await page.getByRole('button', { name: 'Pause', exact: true }).click()
	await page.getByRole('button', { name: 'Resume', exact: true }).click()
	await page.getByRole('button', { name: 'Compose', exact: true }).click()
	await page.getByRole('button', { name: 'Run Skill' }).click()
	await page.getByText('Review the design on Thursday.', { exact: true }).waitFor()
	await page.getByRole('button', { name: 'Trace result' }).click()
	await page.getByRole('dialog', { name: 'Artifact inspector' }).waitFor()
	assert.ok(await page.getByRole('button', { name: 'source ↗', exact: true }).isVisible())
	await page.keyboard.press('Escape')
	assert.equal(await page.getByRole('dialog').count(), 0)
	await page.screenshot({ path: '/tmp/aven-studio-activity.png', fullPage: true })
	await page.getByRole('button', { name: 'Compose', exact: true }).click()
	await page.getByRole('textbox', { name: 'Program name' }).fill('My unsaved edit')
	await page.evaluate(() => {
		const d = window.studioFixture.state.drafts[0]
		d.revision++
		d.definition.name = 'Agent edit'
	})
	await page.getByRole('button', { name: 'Refresh Studio', exact: true }).click()
	await page.getByText('Another client edited this draft.', { exact: false }).waitFor()
	assert.equal(
		await page.getByRole('textbox', { name: 'Program name' }).inputValue(),
		'My unsaved edit'
	)
	await page.getByRole('button', { name: 'Keep as copy' }).click()
	assert.equal(
		await page.getByRole('textbox', { name: 'Program name' }).inputValue(),
		'My unsaved edit'
	)
	await page.setViewportSize({ width: 640, height: 960 })
	await page.screenshot({ path: '/tmp/aven-studio-mobile.png', fullPage: true })
	assert.ok(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
		'No horizontal overflow'
	)
	assert.deepEqual(errors, [])
	console.log(
		'Studio UI: explore, compose, dry-run, publish, connect, run, provenance, conflict and mobile passed.'
	)
} finally {
	await browser.close()
}
