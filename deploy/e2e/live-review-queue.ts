/** Native regression: crowded review queue + written chat through the real Qwen gateway.
 * Uses only the fictional account/environment from a completed live workday.
 * Review fixtures exercise layout and the physical gate; no model response is mocked.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { textPdf } from '../../libs/aven-document-ingest/tests/support/chunk-fixtures'
import { TauriSession } from './tauri-driver'

const root = resolve(import.meta.dir, '../..')
const prior = await Bun.file(process.argv[2]!).json()
assert(
	prior.synthetic && prior.completedAt,
	'Supply a completed fictional live-workday evidence file'
)
const session = await Bun.file('/tmp/aven-live-studio-workday/private-session.json').json()
assert.equal(session.identity, 'http://localhost:13100')
assert.equal(session.accountId, prior.built.subjectId)
const origin = process.env.E2E_APP_ORIGIN ?? 'http://127.0.0.1:1451'
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
const output = `/tmp/aven-live-review-queue/${new Date().toISOString().replaceAll(':', '-')}`
await mkdir(output, { recursive: true })
const evidence: any = {
	synthetic: true,
	environmentId: prior.environmentId,
	turns: [],
	layouts: [],
	startedAt: new Date().toISOString()
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ storageState: session.browser })
const page = await context.newPage()
let native: TauriSession | undefined
async function evaluate<T = any>(body: string): Promise<T> {
	await native!.execute(
		`window.__proofResult = null; (async () => { ${body} })().then(value => window.__proofResult={value}, error => window.__proofResult={error:String(error)});`
	)
	for (let i = 0; i < 1800; i++) {
		const result = await native!.execute<any>('return window.__proofResult')
		if (result?.error) throw Error(result.error)
		if (result) return result.value
		await pause(100)
	}
	throw Error('Native evaluation timed out')
}
async function button(text: string) {
	await native!.execute(
		`const target = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === arguments[0]); if (!target) throw Error('Button missing: '+arguments[0]); target.dataset.reviewProofClick='true';`,
		[text]
	)
	const element = await native!.find('[data-review-proof-click="true"]')
	await native!.click(element)
	await native!.execute(
		"document.querySelector('[data-review-proof-click]')?.removeAttribute('data-review-proof-click')"
	)
}
async function layout(label: string, expectOpen: boolean) {
	await pause(250)
	const measured = await native!.execute<any>(
		`const card=document.querySelector('.gate-card--bounded'); const footer=card?.querySelector('.gate-card-actions'); const main=document.querySelector('main[aria-label="Intent workspace"]'); return {label:arguments[0], width:innerWidth,height:innerHeight,cards:document.querySelectorAll('.gate-card--bounded').length,main:main?.getBoundingClientRect().toJSON(),card:card?.getBoundingClientRect().toJSON(),footer:footer?.getBoundingClientRect().toJSON(),horizontal:document.documentElement.scrollWidth > innerWidth,popups:document.querySelectorAll('[aria-label="Conversation with Aven"]').length};`,
		[label]
	)
	evidence.layouts.push(measured)
	assert.equal(measured.cards, expectOpen ? 1 : 0, JSON.stringify(measured))
	assert(!measured.horizontal, JSON.stringify(measured))
	assert(measured.main.height > 180, JSON.stringify(measured))
	if (expectOpen) {
		assert(measured.footer.height >= 40, JSON.stringify(measured))
		assert(measured.footer.bottom <= measured.height, JSON.stringify(measured))
		assert(measured.footer.bottom <= measured.card.bottom + 1, JSON.stringify(measured))
	}
	console.log('[review] Layout', label, 'activity height:', measured.main.height)
	if (process.env.E2E_CAPTURE_SCREENSHOTS === 'true')
		await writeFile(`${output}/${label}.png`, Buffer.from(await native!.screenshot(), 'base64'))
}
try {
	native = await TauriSession.launch(
		process.env.E2E_TAURI_APPLICATION ?? `${root}/target/rust/debug/aven-os-app`
	)
	await native.waitForBodyText('GERÄTECODE', 45000)
	const code = (await native.bodyText()).match(/\b([A-Z0-9]{4})-([A-Z0-9]{4})\b/)
	assert(code)
	await page.goto(`${session.identity}/device?user_code=${code[1]}${code[2]}`)
	await page.getByRole('button', { name: 'Authorize', exact: true }).click()
	await page.getByRole('heading', { name: 'Device connected', exact: true }).waitFor()
	await native.findEventually('[aria-label="Choose workspace"]', 45000)
	await native.click(await native.find('[aria-label="Choose workspace"]'))
	await native.click(
		await native.findEventually(
			`[data-testid="environment-choice-${prior.environmentId}"]:not(:disabled)`
		)
	)
	await native.findEventually(
		`[data-testid="environment-choice-${prior.environmentId}"][aria-current="page"]`,
		30000
	)
	await native.navigate(
		`${origin}/dashboard?e2eFixture=${encodeURIComponent(`${root}/deploy/e2e/fixtures/e2e-document.txt`)}`
	)
	await native.waitForBodyText('Process on', 45000)
	console.log('[review] Isolated native client authenticated')
	const flight = `${output}/fictional-flight.pdf`
	await writeFile(
		flight,
		textPdf([
			[
				'FICTIONAL ITINERARY',
				'ZX1234*',
				'Flight / Flug',
				'14MAR25',
				'Date / Datum',
				'16:20',
				'Departure / Abflug',
				'Berlin/BER',
				'From / von',
				'Oslo/OSL',
				'To / nach'
			]
		])
	)
	const uploaded = await evaluate(
		`return await window.__avenWorkday.ingest(${JSON.stringify(flight)}, 'local');`
	)
	evidence.uploaded = uploaded
	console.log('[review] Flight imported', JSON.stringify(uploaded))
	for (let i = 0; i < 600; i++) {
		const p = await evaluate(
			`return window.__avenWorkday.processing(${JSON.stringify(uploaded.artifactId)});`
		)
		assert(p?.state !== 'failed', JSON.stringify(p))
		if (p && ['succeeded', 'needs_review'].includes(p.state)) break
		if (i === 599) throw Error('Flight processing did not finish')
		await pause(500)
	}
	await evaluate(
		`const {bus}=await import('/src/lib/actors/bus.ts'); window.__reviewDecisions=[]; for(let i=0;i<24;i++) bus.holdAction({id:'review-proof:'+i,scope:'workspace',actor:'review-proof',method:'compare',label:'Check document relationship',detail:'Fictional layout fixture',preview:{kind:'Document match',layout:'compare',title:'Does this invoice belong with this payment?',sides:[{heading:'Invoice '+(i+1),lines:['Cedar Services','86.45 EUR','14 March 2025',...Array(8).fill('Long evidence remains readable in the scrolling body.')]},{heading:'Payment',lines:['Cedar Services','-86.45 EUR','14 March 2025','Invoice CD-1234']}] }},{confirm:async()=>{window.__reviewDecisions.push('confirm:'+i);return {record:'{"ok":true}',wire:'saved'}},reject:async()=>{window.__reviewDecisions.push('reject:'+i)}});`
	)
	await layout('collapsed', false)
	await native.click(await native.find('.review-queue-toggle'))
	await layout('expanded', true)
	for (let i = 0; i < 50; i++) {
		if (
			(await native.execute(
				"return document.querySelector('.gate-card--bounded').dataset.heldId"
			)) === 'review-proof:0'
		)
			break
		await native.click(await native.find('[aria-label="Next review"]'))
	}
	await native.click(await native.find('[aria-label="Next review"]'))
	assert.equal(
		await native.execute("return document.querySelector('.gate-card--bounded').dataset.heldId"),
		'review-proof:1'
	)
	await button('Later')
	assert.deepEqual(await native.execute('return window.__reviewDecisions'), [])
	await layout('later', false)
	// New background work must not reopen the panel or jump to another review.
	await evaluate(
		`const {bus}=await import('/src/lib/actors/bus.ts');bus.holdAction({id:'review-proof:extra',scope:'workspace',actor:'review-proof',method:'compare',label:'One more review',detail:'Fictional'}, {confirm:async()=>({record:'{"ok":true}',wire:'saved'})});`
	)
	await layout('new-arrival', false)
	await native.click(await native.find('.review-queue-toggle'))
	await native.click(await native.find('[aria-label="Start conversation"]'))
	assert.equal(
		await native.execute(
			'return document.querySelectorAll(\'[aria-label="Conversation with Aven"]\').length'
		),
		0
	)
	await layout('inline-chat', false)
	for (const prompt of [
		'Welcher Zielort steht im synthetischen Reisebeleg?',
		'Welche Flugnummer und welches Datum stehen im Beleg?',
		'Welches Datum ist heute (YYYY-MM-DD), welche Zeitzone gilt hier, und liegt der Tag nach meinem Flug noch in der Zukunft? Bitte nichts anlegen.',
		'Ich möchte rückblickend einen fiktiven Tagesplan für den Tag nach diesem damaligen Flug entwerfen, nur hier im Chat. Inhalt: ruhiges Frühstück, Spaziergang und Museum, ohne behauptete Öffnungszeiten. Bevor du ihn ausarbeitest, frag mich bitte nur noch, ob wir früh oder spät anfangen sollen.',
		'Spät. Ja, mach genau diesen Plan.'
	]) {
		await native.click(await native.find('[aria-label="Start conversation"]'))
		const before = await evaluate('return window.__avenWorkday.state();')
		const field = await native.findEventually('[aria-label="Message Aven"]')
		await native.type(field, prompt)
		await native.click(await native.find('[aria-label="Send message"], [aria-label="Senden"]'))
		let state: any
		for (let i = 0; i < 1200; i++) {
			state = await evaluate('return window.__avenWorkday.state();')
			if (!state.streaming && !state.routing && state.turns.length > before.turns.length) break
			await pause(500)
		}
		assert.equal(state.failure, null, state.failure)
		const added = state.turns.slice(before.turns.length)
		const calls = added.flatMap((turn: any) => turn.calls ?? [])
		evidence.turns.push({ prompt, turns: added, diagnostics: state.diagnostics })
		await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2))
		assert(
			calls.every((call: any) => call.status === 'completed'),
			JSON.stringify(calls)
		)
		assert(calls.filter((call: any) => call.name === 'research_record').length <= 1)
		assert(calls.length <= 2, `Unnecessary calls: ${JSON.stringify(calls)}`)
		const answer = added
			.filter((turn: any) => turn.role === 'assistant')
			.map((turn: any) => turn.content)
			.join('\n')
		if (prompt.startsWith('Welches Datum')) {
			const date = await native.execute<string>(
				"return new Intl.DateTimeFormat('en-CA', {year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())"
			)
			assert(answer.includes(date), answer)
			assert(/Europe\/Berlin|MESZ|CEST/.test(answer), answer)
			assert(/Vergangenheit|vergangen|vorbei|zurück|nicht.*Zukunft/s.test(answer), answer)
			const request = await evaluate('return window.__avenWorkday.request();')
			assert(JSON.stringify(request).includes('CURRENT DEVICE TIME'))
			assert(calls.every((call: any) => ['workspace_read', 'research_record'].includes(call.name)))
		} else if (prompt.startsWith('Ich möchte')) {
			assert(/früh|spät/i.test(answer), answer)
			assert.equal(calls.filter((call: any) => call.name.startsWith('todo_')).length, 0)
		} else if (prompt.startsWith('Spät.')) {
			assert(
				/Frühstück/i.test(answer) && /Spaziergang/i.test(answer) && /Museum/i.test(answer),
				answer
			)
			assert(/15[.\s]|2025-03-15/.test(answer), answer)
			assert(
				!/bestätigen.*Datum|Datum.*bestätigen|nicht.*(Beleg|PDF).*enthalten/s.test(answer),
				answer
			)
			assert(calls.every((call: any) => ['workspace_read', 'research_record'].includes(call.name)))
		} else assert(answer.includes(prompt.includes('Flugnummer') ? 'ZX1234' : 'Oslo'), answer)
		console.log('[review]', prompt, 'calls:', calls.length, 'all successful;', answer)
	}
	await layout('answered', false)
	await evaluate(
		`const {composer}=await import('/src/lib/intents/composer.svelte.ts'); composer.active=false;composer.draft='';`
	)
	await native.click(await native.find('.review-queue-toggle'))
	// Confirm/reject only the synthetic fixture, never a financial proposal.
	for (let i = 0; i < 50; i++) {
		if (
			String(
				await native.execute("return document.querySelector('.gate-card--bounded').dataset.heldId")
			).startsWith('review-proof:')
		)
			break
		await native.click(await native.find('[aria-label="Next review"]'))
	}
	assert.match(
		await native.execute<string>(
			"return document.querySelector('.gate-card--bounded').dataset.heldId"
		),
		/^review-proof:/
	)
	await button('Reject')
	await pause(300)
	assert.equal((await native.execute<string[]>('return window.__reviewDecisions')).length, 1)
	evidence.completedAt = new Date().toISOString()
	console.log('[review] PASS', output)
} catch (error) {
	evidence.error = String(error)
	if (native) {
		evidence.body = await native.bodyText().catch(String)
		if (process.env.E2E_CAPTURE_SCREENSHOTS === 'true')
			await writeFile(
				`${output}/failure.png`,
				Buffer.from(await native.screenshot().catch(() => ''), 'base64')
			)
	}
	throw error
} finally {
	await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2))
	await native?.close()
	await context.close()
	await browser.close()
}
