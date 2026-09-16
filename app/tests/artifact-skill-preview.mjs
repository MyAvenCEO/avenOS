import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { draftFor } from '../../libs/aven-actors/src/studio/index.ts'

const fileId = '11111111-1111-4111-8111-111111111111'
const skillId = '22222222-2222-4222-8222-222222222222'
const definition = draftFor({ key: 'core.file', version: 1 },
	{ key: 'studio.understanding', version: 1 }, 'Inspect project updates')
const file = {
	artifactId: fileId, localKey: 'file', publicationOrdinal: 0,
	typeKey: 'core.file', typeVersion: 1, artifactSha256: 'file-digest',
	producerRunId: null, output: null, inputs: [], publicationId: fileId,
	scopeSequence: 1, publicationKind: 'roots', runId: null,
	committedAt: '2026-09-16T12:00:00Z'
}
const skill = {
	artifactId: skillId, localKey: 'skill', publicationOrdinal: 0,
	typeKey: 'studio.skill', typeVersion: 1, artifactSha256: 'skill-digest',
	producerRunId: null, output: null,
	inputs: [{ role: 'predecessor', ordinal: 0, artifactId: fileId }],
	publicationId: skillId, scopeSequence: 2, publicationKind: 'run', runId: null,
	committedAt: '2026-09-16T12:01:00Z'
}

const browser = await chromium.launch({ headless: true })
try {
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
	page.setDefaultTimeout(10000)
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.goto((process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1449') + '/dashboard')
	await page.getByRole('button', { name: 'Artefakte', exact: true }).waitFor()
	await page.evaluate(({ file, skill, definition }) => {
		window.isTauri = true
		window.__TAURI_INTERNALS__ = {
			invoke: async (command, args) => {
				window.previewCalls.push({ command, args: structuredClone(args ?? {}) })
				if (command === 'artifact_store_list')
					return { storeEpoch: 'fixture-epoch', artifacts: [file, skill], truncated: false }
				if (command === 'artifact_query')
					return { snapshotSequence: 2, items: [{ ...skill, payload: definition }], nextAfter: null }
				if (command === 'artifact_get')
					return args.artifactId === skill.artifactId
						? { ...skill, payload: definition, blob: null }
						: { ...file, payload: { originalName: 'project-update.txt',
							declaredMediaType: 'text/plain' }, blob: { length: 10 } }
				if (command === 'artifact_evidence_get') return { artifactId: args.artifactId, evidence: [] }
				if (command === 'artifact_content_get') return { mediaType: 'text/plain', base64: 'cHJvamVjdA==' }
				return null
			}
		}
		window.previewCalls = []
	}, { file, skill, definition })
	await page.getByRole('button', { name: 'Artefakte', exact: true }).click()
	await page.getByRole('group', { name: 'Artifact filter' })
		.getByRole('button', { name: 'Skills', exact: true }).click()
	const card = page.getByRole('button', { name: 'Open Skill Inspect project updates' })
	await card.waitFor()
	await card.click()
	await page.getByRole('article').getByRole('heading', { name: 'Inspect project updates' }).waitFor()
	await page.getByRole('region', { name: 'Saved Skill steps' }).getByText('Inspect project updates').waitFor()
	const calls = await page.evaluate(() => window.previewCalls)
	assert(calls.some((call) => call.command === 'artifact_query' && call.args.typeKey === 'studio.skill'))
	assert(calls.some((call) => call.command === 'artifact_get' && call.args.artifactId === skillId))
	assert(!calls.some((call) => ['studio_request', 'artifact_content_get'].includes(call.command) &&
		call.args?.artifactId === skillId))
	assert(!calls.some((call) => ['artifact_file_publish', 'actor_run_start'].includes(call.command)))
	await page.getByRole('group', { name: 'Artifact filter' })
		.getByRole('button', { name: 'Files', exact: true }).click()
	await page.getByRole('button', { name: /project-update/ }).waitFor()
	assert.equal(errors.length, 0, errors.join('\n'))
	console.log('Artifact Skill preview: derived Skill index, visual definition, pure viewing, and Files filter passed.')
} finally {
	await browser.close()
}
