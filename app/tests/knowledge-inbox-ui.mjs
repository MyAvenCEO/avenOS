// Interaction/layout checks using actual Store receipts and real Qwen answers.
// This is not a native upload/admission proof; those use the live service journey.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

const intake = JSON.parse(await readFile(process.argv[2], 'utf8'))
assert.equal(intake.synthetic, true)
assert.equal(intake.passed, true)
assert(
	intake.intake.checks.length >= 8,
	'Use the completed live service intake lane, including quota and retry checks'
)
const knowledge = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : null
if (knowledge) {
	assert.equal(knowledge.synthetic, true)
	assert.equal(knowledge.passed, true)
}
const output = '/tmp/aven-knowledge-inbox-ui/' + new Date().toISOString().replaceAll(':', '-')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const proof = []
try {
	for (const viewport of [
		{ width: 1280, height: 800 },
		{ width: 390, height: 700 }
	]) {
		const page = await browser.newPage({ viewport }),
			errors = []
		page.on('pageerror', (e) => errors.push(e.message))
		await page.goto(`${process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1457'}/dashboard`)
		await page.getByRole('button', { name: '↓ Posteingang' }).waitFor()
		await page.getByRole('button', { name: '↓ Posteingang' }).click()
		await page.evaluate(async (uploads) => {
			const { uploadInbox } = await import('/src/lib/artifacts/upload-inbox.svelte.ts')
			uploadInbox.items = uploads.map((receipt) => ({
				artifactId: receipt.artifactId,
				payload: {
					originalName: receipt.originalName,
					declaredMediaType: receipt.mediaType,
					observedAt: receipt.observedAt ?? new Date().toISOString()
				},
				blob: { length: receipt.length }
			}))
		}, intake.intake.uploads)
		const inbox = page.getByRole('main', { name: 'Upload inbox' })
		await expect(inbox.getByText('September invoice.txt', { exact: true })).toBeVisible()
		await inbox.getByRole('checkbox', { name: 'September invoice.txt', exact: true }).check()
		const admit = inbox.getByRole('button', { name: 'Zuordnen & verarbeiten', exact: true })
		await expect(admit).toBeDisabled()
		await inbox.getByRole('textbox', { name: 'Worum geht es?' }).fill('Belege September')
		await expect(admit).toBeEnabled()
		// Selection is a local draft. Do not submit without a native service bridge.
		for (const element of [inbox, admit, inbox.getByRole('combobox')]) {
			const box = await element.boundingBox()
			assert(
				box &&
					box.x >= 0 &&
					box.y >= 0 &&
					box.x + box.width <= viewport.width + 1 &&
					box.y + box.height <= viewport.height + 1
			)
		}
		assert.equal(await inbox.evaluate((node) => node.scrollWidth > node.clientWidth + 1), false)
		if (viewport.width < 500) {
			assert(
				(await inbox.getByRole('combobox').boundingBox()).width > 200,
				'The destination must remain readable on narrow screens'
			)
			assert(
				(await inbox.getByRole('textbox', { name: 'Worum geht es?' }).boundingBox()).width > 200,
				'The Intent title must not collapse beside the action'
			)
		}
		await page.screenshot({ path: `${output}/inbox-${viewport.width}.png` })
		await page.getByRole('button', { name: 'Start conversation', exact: true }).click()
		await expect(page.getByRole('region', { name: 'Conversation with Aven' })).toBeVisible()
		await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
		await expect(inbox.getByRole('textbox', { name: 'Worum geht es?' })).toHaveValue(
			'Belege September'
		)
		if (knowledge) {
			const turn = knowledge.knowledge.turns.find((turn) => turn.question.includes('brutto summen'))
			assert(turn)
			await page.evaluate(async (turn) => {
				const { chatActor } = await import('/src/lib/actors/chat.actor.svelte.ts')
				chatActor.core.turns = [
					{ id: crypto.randomUUID(), role: 'user', content: turn.question },
					{ id: crypto.randomUUID(), role: 'assistant', content: turn.answer, calls: turn.calls }
				]
			}, turn)
			await page.getByRole('button', { name: 'Start conversation', exact: true }).click()
			const card = page.getByRole('article', { name: 'Knowledge query result' })
			await expect(card).toContainText('124,00')
			await expect(card).toContainText('50,00')
			await card.scrollIntoViewIfNeeded()
			assert.equal(await card.evaluate((node) => node.scrollWidth > node.clientWidth + 1), false)
			await page.screenshot({ path: `${output}/knowledge-${viewport.width}.png` })
		}
		assert.deepEqual(errors, [])
		proof.push({
			viewport,
			errors,
			inboxSelection: true,
			chatAvailable: true,
			knowledgeRendered: Boolean(knowledge)
		})
		await page.close()
	}
	await writeFile(
		output + '/evidence.json',
		JSON.stringify(
			{ passed: true, intakeEvidence: process.argv[2], knowledgeEvidence: process.argv[3], proof },
			null,
			2
		)
	)
	console.log('PASS', output)
} finally {
	await browser.close()
}
