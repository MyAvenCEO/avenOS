/** Physical copying and voting on real Qwen replies in the native client and customer DB.
 * Fault injections cover denied clipboard access and one lost acknowledgment
 * AFTER a real feedback write commits; model responses are never substituted.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { TauriSession } from './tauri-driver'

const root = resolve(import.meta.dir, '../..')
const prior = await Bun.file(process.argv[2]!).json()
assert(prior.synthetic && prior.completedAt, 'Supply completed fictional workday evidence')
const session = await Bun.file('/tmp/aven-live-studio-workday/private-session.json').json()
assert.equal(session.identity, 'http://localhost:13100')
assert.equal(session.accountId, prior.built.subjectId)
assert.match(prior.environmentId, /^[0-9a-f-]{36}$/)
const origin = process.env.E2E_APP_ORIGIN ?? 'http://127.0.0.1:1451'
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
const output = `/tmp/aven-live-response-feedback/${new Date().toISOString().replaceAll(':', '-')}`
await mkdir(output, { recursive: true })
const evidence: any = {
	synthetic: true,
	environmentId: prior.environmentId,
	startedAt: new Date().toISOString(),
	checks: []
}
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ storageState: session.browser })
const page = await context.newPage()
let native: TauriSession | undefined
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function evaluate<T = any>(body: string): Promise<T> {
	await native!.execute(
		`window.__feedbackResult=null; (async()=>{${body}})().then(value=>window.__feedbackResult={value},error=>window.__feedbackResult={error:String(error)});`
	)
	for (let i = 0; i < 600; i++) {
		const result = await native!.execute<any>('return window.__feedbackResult')
		if (result?.error) throw Error(result.error)
		if (result) return result.value
		await pause(100)
	}
	throw Error('Native evaluation timed out')
}
async function button(selector: string) {
	evidence.lastButton = selector
	await native!.findEventually(selector)
	await native!.execute(
		'document.querySelector(arguments[0]).scrollIntoView({block:"center",inline:"nearest"})',
		[selector]
	)
	await pause(100)
	await native!.click(await native!.findEventually(selector))
}
async function waitFor(predicate: string, timeout = 30000) {
	const deadline = Date.now() + timeout
	while (Date.now() < deadline) {
		if (await native!.execute(`return Boolean(${predicate})`)) return
		await pause(150)
	}
	throw Error(`Condition timed out: ${predicate}\n${await native!.bodyText()}`)
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
	await button('[aria-label="Choose workspace"]')
	await button(`[data-testid="environment-choice-${prior.environmentId}"]:not(:disabled)`)
	await native.findEventually(
		`[data-testid="environment-choice-${prior.environmentId}"][aria-current="page"]`,
		30000
	)
	const url = `${origin}/dashboard?e2eFixture=${encodeURIComponent(`${root}/deploy/e2e/fixtures/e2e-document.txt`)}`
	await native.navigate(url)
	await native.waitForBodyText('Process on', 45000)
	const intentId = crypto.randomUUID()
	evidence.intentId = intentId
	await evaluate(
		`await window.__TAURI_INTERNALS__.invoke('intent_create',{intent:{id:${JSON.stringify(intentId)},title:'Fictional response feedback proof',intentType:'conversation',sourceLabel:'Chat'}});`
	)
	await native.navigate(url)
	await native.waitForBodyText('Process on', 45000)
	await button(`[data-upload-intent-id="${intentId}"]`)
	const prompts = [
		'Antworte mit einer kurzen Markdown-Liste mit zwei Punkten:\nWie hilft ein Dokumentenindex beim Wiederfinden alter Rechnungen?\nLege nichts an. Verwende Umlaute wie „übersichtlich“.',
		'Und welches eine Feld wäre dafür besonders hilfreich? Bitte nur ein kurzes Beispiel, nichts speichern.'
	]
	for (const prompt of prompts) {
		const before = await evaluate('return window.__avenWorkday.state();')
		await button('[aria-label="Start conversation"]')
		await native.type(await native.findEventually('[aria-label="Message Aven"]'), prompt)
		await button('[aria-label="Send message"], [aria-label="Senden"]')
		await waitFor(
			`!window.__avenWorkday.state().streaming && !window.__avenWorkday.state().routing && window.__avenWorkday.state().turns.length>${before.turns.length}`,
			180000
		)
		assert.equal((await evaluate('return window.__avenWorkday.state();')).failure, null)
	}
	await waitFor(
		'window.__avenWorkday.state().turns.filter(t=>t.role==="assistant").every(t=>t.persisted)'
	)
	const turns = (await evaluate('return window.__avenWorkday.state();')).turns
	evidence.turns = turns
	const replies = turns.filter((t: any) => t.role === 'assistant')
	assert.equal(replies.length, 2)
	async function copyMessages(surface: string) {
		for (const turn of turns) {
			const selector = `[data-message-id="${turn.id}"]`
			await button(`${selector} [aria-label="Copy message"]`)
			await waitFor(
				`document.querySelector(${JSON.stringify(selector)})?.textContent.includes('Copied')`
			)
			// Read the actual X11 clipboard on the isolated test display, outside
			// the webview. No stubbed clipboard API or synthetic click.
			const copied = execFileSync(
				'/usr/bin/python3',
				[
					'-c',
					"import gi,sys; gi.require_version('Gtk','3.0'); from gi.repository import Gtk,Gdk; value=Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text(); sys.stdout.write(value if value is not None else '')"
				],
				{ encoding: 'utf8', timeout: 10000 }
			)
			assert.equal(copied, turn.content, `${surface}: exact source of ${turn.role} message`)
		}
		evidence.checks.push({ surface, copiedMessages: turns.length, exactSource: true })
	}
	await copyMessages('Intent history')
	const copySelector = `[data-message-id="${turns[0].id}"] [aria-label="Copy message"]`
	await native!.execute(
		`window.__clipboardWrite=navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText=async()=>{throw new Error('Test: clipboard permission denied')}`
	)
	await button(copySelector)
	await native.waitForBodyText('Couldn’t copy. Try again or select the text to copy manually.')
	await native!.execute(
		'navigator.clipboard.writeText=window.__clipboardWrite; delete window.__clipboardWrite'
	)
	// Keyboard activation retries the real clipboard write; it must not submit chat.
	await native!.type(await native!.find(copySelector), '\uE007')
	await waitFor(`document.querySelector(${JSON.stringify(copySelector)})?.title==='Copied'`)
	await waitFor(`document.querySelector(${JSON.stringify(copySelector)})?.title==='Copy message'`)
	assert.equal((await evaluate('return window.__avenWorkday.state();')).turns.length, turns.length)
	evidence.checks.push({
		clipboardFailureRecovery: true,
		keyboardActivation: true,
		confirmationResets: true
	})
	const responseId = replies[0].id
	console.log('[feedback] Two real Qwen replies saved')
	evidence.responseId = responseId
	const base = `[data-response-id="${responseId}"]`
	const up = `${base} [aria-label="Helpful response"]`
	const down = `${base} [aria-label="Unhelpful response"]`
	async function saved(vote: string | null, reason: string) {
		await waitFor(
			`!document.querySelector(${JSON.stringify(base)})?.textContent.includes('Saving…')`
		)
		const detail = await evaluate(
			`return await window.__TAURI_INTERNALS__.invoke('intent_get',{intentId:${JSON.stringify(intentId)}});`
		)
		const response = detail.contributions.find((c: any) => c.id === responseId)
		assert.equal(response.text, replies[0].content)
		assert.equal(response.feedback.vote, vote)
		assert.equal(response.feedback.reason, reason)
		assert(Number.isSafeInteger(response.feedback.sequence) && response.feedback.sequence > 0)
		assert.equal(detail.contributions.find((c: any) => c.id === replies[1].id).feedback, null)
		assert.equal(detail.contributions.filter((c: any) => c.kind === 'message').length, 4)
		assert.equal(
			detail.contributions.some((c: any) => c.kind === 'response-feedback'),
			false
		)
		evidence.checks.push({ vote, reason, id: response.feedback.id })
		return response.feedback
	}
	await button(down)
	await saved('down', '')
	await button(`${base} .reason-link`)
	await native.type(await native.find(`${base} textarea`), 'Bitte ein konkretes Beispiel nennen.')
	await button(`${base} button[type="submit"]`)
	await saved('down', 'Bitte ein konkretes Beispiel nennen.')
	// A full webview reload must restore metadata from the customer database.
	await native.navigate(url)
	await native.waitForBodyText('Process on', 45000)
	await button(`[data-upload-intent-id="${intentId}"]`)
	await waitFor(
		`document.querySelector(${JSON.stringify(down)})?.getAttribute('aria-pressed')==='true'`
	)
	await button(`${base} .reason-link`)
	assert.equal(
		await native.execute(
			`return document.querySelector(${JSON.stringify(base + ' textarea')}).value`
		),
		'Bitte ein konkretes Beispiel nennen.'
	)
	await native.type(await native.find(`${base} textarea`), ' Danke!')
	// The unfinished reason follows the same reply to Studio's popup.
	await button('[aria-label="Skills"]')
	await button('[aria-label="Start conversation"]')
	await native.findEventually('[aria-label="Conversation with Aven"]')
	await copyMessages('Studio popup')
	assert.equal(
		await native.execute(
			`return document.querySelector(${JSON.stringify(base + ' textarea')}).value`
		),
		'Bitte ein konkretes Beispiel nennen. Danke!'
	)
	await button(`${base} button[type="submit"]`)
	await saved('down', 'Bitte ein konkretes Beispiel nennen. Danke!')
	await button(up)
	await saved('up', 'Bitte ein konkretes Beispiel nennen. Danke!')
	await button(up) // clicking selected vote clears it and its reason
	await saved(null, '')
	console.log('[feedback] Vote, inline reason, reload, surface handoff and clear passed')
	// Real write, then one lost acknowledgment. Retry must reuse the command ID.
	await native.execute(
		`const original=window.fetch; window.__feedbackWrites=[]; let lose=true; window.fetch=async function(url,options){const result=await original.call(this,url,options); if(String(url).includes('intent_append_contribution')) {const args=JSON.parse(typeof options.body==='string'?options.body:new TextDecoder().decode(options.body)); if(args.contribution?.kind==='response-feedback'){window.__feedbackWrites.push(args.contribution.id);if(lose&&result.headers.get('Tauri-Response')==='ok'){lose=false;await result.json(); return new Response(JSON.stringify('Test: acknowledgment lost after commit'),{headers:{'Tauri-Response':'error','content-type':'application/json'}})}}} return result;}`
	)
	await button(up)
	await waitFor(
		`document.querySelector(${JSON.stringify(base + ' [role="alert"]')})?.textContent.includes('acknowledgment lost')`
	)
	await button(`${base} .feedback-error button:first-of-type`)
	await saved('up', '')
	const writes = await native.execute<string[]>('return window.__feedbackWrites')
	assert.equal(writes.length, 2)
	assert.equal(writes[0], writes[1])
	// Inspect only this synthetic Intent's customer rows; no credentials in evidence.
	const sql = `SELECT jsonb_agg(jsonb_build_object('id',id,'owner',owner_subject_id,'kind',kind,'text',text,'payload',payload) ORDER BY sequence) FROM aven_intents.contributions WHERE intent_id='${intentId}';`
	const rows = JSON.parse(
		execFileSync(
			'docker',
			[
				'exec',
				'aven-local-platform-database-1',
				'psql',
				'-U',
				'postgres',
				'-d',
				`cust_${prior.environmentId.replaceAll('-', '')}`,
				'-X',
				'-At',
				'-c',
				sql
			],
			{ encoding: 'utf8' }
		)
	)
	const feedback = rows.filter((r: any) => r.kind === 'response-feedback')
	assert.equal(feedback.length, 6)
	assert(
		feedback.every(
			(r: any) =>
				r.payload.responseId === responseId && r.owner === session.accountId && r.text === null
		)
	)
	evidence.feedbackRows = feedback
	assert.equal((await evaluate('return window.__avenWorkday.state();')).turns.length, 4)
	evidence.completedAt = new Date().toISOString()
	console.log('Response feedback PASS:', output)
} catch (error) {
	evidence.error = String(error)
	evidence.body = await native?.bodyText().catch(String)
	evidence.hitTest = await native
		?.execute(
			`const e=document.querySelector(arguments[0]); if(!e)return null; const r=e.getBoundingClientRect();return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},top:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,1200)}`,
			[evidence.lastButton]
		)
		.catch(String)
	throw error
} finally {
	await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2))
	await native?.close()
	await context.close()
	await browser.close()
}
