// Real components + physical review callbacks, no chat/model substitutions.
// The companion native live-review-queue test exercises actual Qwen conversation.
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const browser = await chromium.launch({ headless: true })
try {
	for (const [width, height] of [
		[1280, 800],
		[390, 844],
		[1024, 600]
	]) {
		const page = await browser.newPage({ viewport: { width, height } })
		const errors = []
		page.on('pageerror', (error) => errors.push(error.message))
		await page.goto(`${process.env.AVEN_STUDIO_UI_URL ?? 'http://127.0.0.1:1451'}/dashboard`)
		await page.getByRole('button', { name: 'Start conversation', exact: true }).waitFor()
		await page.evaluate(async () => {
			const { intents } = await import('/src/lib/intents/intents.svelte.ts')
			const { shell } = await import('/src/lib/intents/talk.svelte.ts')
			const { bus } = await import('/src/lib/actors/bus.ts')
			intents.beginFileIntent('layout-fixture', 'Fictional flight')
			shell.detail = true
			shell.rightOpen = false
			window.reviewDecisions = []
			for (let i = 0; i < 30; i++)
				bus.holdAction(
					{
						id: 'fixture:' + i,
						actor: 'fixture',
						method: 'compare',
						scope: 'workspace',
						label: 'Check document relationship',
						detail: 'Fictional fixture',
						preview: {
							kind: 'Document match',
							layout: 'compare',
							title: 'Does this invoice belong with this payment?',
							sides: [
								{
									heading: 'Invoice ' + (i + 1),
									lines: [
										'Cedar Services',
										'86.45 EUR',
										'14 March 2025',
										...Array(20).fill('This long piece of evidence must remain readable.')
									]
								},
								{
									heading: 'Payment',
									lines: ['Cedar Services', '-86.45 EUR', '14 March 2025', 'CD-1234']
								}
							]
						}
					},
					{
						confirm: async () => {
							window.reviewDecisions.push('confirm:' + i)
							return { record: '{"ok":true}', wire: 'saved' }
						},
						reject: async () => {
							window.reviewDecisions.push('reject:' + i)
						}
					}
				)
		})
		const toggle = page.locator('[data-review-scope="workspace"]')
		const card = page.locator('.gate-card--bounded')
		const main = page.getByRole('main', { name: 'Intent workspace' })
		await expect(toggle).toHaveAttribute('aria-expanded', 'false')
		await expect(card).toHaveCount(0)
		await page.screenshot({ path: `/tmp/aven-review-collapsed-${width}.png` })
		await toggle.click()
		await expect(card).toHaveCount(1)
		const footer = card.locator('.gate-card-actions')
		await expect(footer.getByRole('button', { name: 'Confirm', exact: true })).toBeInViewport()
		await expect(footer.getByRole('button', { name: 'Reject', exact: true })).toBeInViewport()
		assert((await main.boundingBox()).height > 160)
		assert((await card.boundingBox()).height <= height * 0.45 + 1)
		assert(await card.locator('.gate-card-body').evaluate((e) => e.scrollHeight > e.clientHeight))
		assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
		await page.screenshot({ path: `/tmp/aven-review-expanded-${width}.png` })
		await page.getByRole('button', { name: 'Next review', exact: true }).click()
		await expect(card).toHaveAttribute('data-held-id', 'fixture:1')
		await page.getByRole('button', { name: 'Later', exact: true }).click()
		await expect(card).toHaveCount(0)
		assert.deepEqual(await page.evaluate(() => window.reviewDecisions), [])
		await toggle.click()
		await page.getByRole('button', { name: 'Start conversation', exact: true }).click()
		await expect(card).toHaveCount(0)
		await expect(page.getByRole('region', { name: 'Conversation with Aven' })).toHaveCount(0)
		const input = page.getByRole('textbox', { name: 'Message Aven', exact: true })
		await input.fill('Keep this unfinished question')
		// Reviews remain reachable while a draft exists, without losing that draft.
		await toggle.click()
		await expect(card).toHaveCount(1)
		await expect(input).toHaveValue('Keep this unfinished question')
		await card.getByRole('button', { name: 'Reject', exact: true }).click()
		await expect(toggle).toContainText('29')
		assert.equal((await page.evaluate(() => window.reviewDecisions)).length, 1)
		assert.deepEqual(errors, [])
		await page.close()
		console.log('Review queue PASS', width, height)
	}
} finally {
	await browser.close()
}
