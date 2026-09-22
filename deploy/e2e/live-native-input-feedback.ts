/** Real native input -> Qwen router -> customer DB -> editable feedback. Synthetic account only. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { TauriSession } from './tauri-driver'

const [binary, privateSession, environmentId] = process.argv.slice(2)
assert(binary && privateSession && environmentId)
const session = JSON.parse(await readFile(privateSession, 'utf8'))
assert.equal(session.identity, 'http://localhost:13100')
const out = await mkdtemp('/tmp/aven-native-input-feedback-')
const evidence: any = {
	synthetic: true,
	environmentId,
	startedAt: new Date().toISOString(),
	passed: false,
	checks: []
}
const browser = await chromium.launch({ headless: true })
let native: TauriSession | undefined
async function evaluate(body: string) {
	await native!.execute(
		`window.__feedbackProbe=null;(async()=>{${body}})().then(value=>window.__feedbackProbe={value},e=>window.__feedbackProbe={error:String(e)});`
	)
	for (let i = 0; i < 300; i++) {
		const result = await native!.execute<any>('return window.__feedbackProbe')
		if (result?.error) throw Error(result.error)
		if (result) return result.value
		await Bun.sleep(100)
	}
	throw Error('Native call timed out')
}
async function wait(check: string, ms = 30000) {
	const deadline = Date.now() + ms
	while (Date.now() < deadline) {
		if (await native!.execute(`return Boolean(${check})`)) return
		await Bun.sleep(150)
	}
	throw Error(`Timed out: ${check}`)
}
async function click(selector: string) {
	await native!.findEventually(selector)
	await native!.execute('document.querySelector(arguments[0]).scrollIntoView({block:"center"})', [
		selector
	])
	await native!.click(await native!.find(selector))
}
try {
	const context = await browser.newContext({ storageState: session.browser })
	const page = await context.newPage()
	native = await TauriSession.launch(binary)
	await native.waitForBodyText('GERÄTECODE', 45000)
	const code = (await native.bodyText()).match(/\b([A-Z0-9]{4})-([A-Z0-9]{4})\b/)
	assert(code)
	await page.goto(`${session.identity}/device?user_code=${code[1]}${code[2]}`)
	await page.getByRole('button', { name: 'Authorize', exact: true }).click()
	await page.getByRole('heading', { name: 'Device connected', exact: true }).waitFor()
	for (let i = 0; ; i++) {
		assert(i < 100)
		if (
			(await evaluate("return await window.__TAURI_INTERNALS__.invoke('auth_status')"))
				.authenticated
		)
			break
		await Bun.sleep(250)
	}
	await evaluate(
		`return await window.__TAURI_INTERNALS__.invoke('auth_environment_select',{environmentId:${JSON.stringify(environmentId)}})`
	)
	await native.navigate('http://127.0.0.1:1457/dashboard')
	await native.waitForBodyText('Process on', 45000)
	await native.execute(`window.__routingProof=[];const invoke=window.__TAURI_INTERNALS__.invoke;
		window.__TAURI_INTERNALS__.invoke=async function(command,args,...rest){
			try{return await invoke.call(this,command,args,...rest)}catch(error){
				if(command==='input_decision')window.__routingProof.push({request:args,error:String(error)});
				throw error;
			}};`)
	const id = crypto.randomUUID()
	evidence.intentId = id
	async function attach() {
		await evaluate(`const {chatActor}=await import('/src/lib/actors/chat.actor.svelte.ts');
			const {intents}=await import('/src/lib/intents/intents.svelte.ts');
			const {refreshIntent}=await import('/src/lib/artifacts/ingest.svelte.ts');
			await refreshIntent(${JSON.stringify(id)});intents.select(${JSON.stringify(id)});
			window.__feedbackChat=chatActor.core;return true;`)
	}
	await evaluate(
		`return await window.__TAURI_INTERNALS__.invoke('intent_create',{intent:{id:${JSON.stringify(id)},title:'Fictional railway workshop feedback',intentType:'conversation',sourceLabel:'Chat'}})`
	)
	await attach()
	async function send(text: string) {
		const count = await native!.execute<number>('return window.__feedbackChat.turns.length')
		if (
			!(await native!.execute('return !!document.querySelector(arguments[0])', [
				'[aria-label="Message Aven"]'
			]))
		)
			await click('[aria-label="Start conversation"]')
		await native!.type(await native!.findEventually('[aria-label="Message Aven"]'), text)
		assert.equal(
			await native!.execute('return document.querySelector(arguments[0]).value', [
				'[aria-label="Message Aven"]'
			]),
			text
		)
		await click('[aria-label="Senden"], [aria-label="Send message"]')
		await wait(
			`window.__feedbackChat.input.items.some(i=>i.stage==='failed'||i.stage==='choice') || (window.__feedbackChat.turns.length>${count} && !window.__feedbackChat.working && !window.__feedbackChat.input.items.length && window.__feedbackChat.turns.filter(t=>t.role==='assistant').every(t=>t.persisted))`,
			180000
		)
		assert.equal(
			await native!.execute('return window.__feedbackChat.input.items.length'),
			0,
			'The explicit follow-up should be admitted without another destination question'
		)
		const turns = await evaluate(
			'return window.__feedbackChat.turns.map(t=>({id:t.id,role:t.role,content:t.content,persisted:t.persisted,feedback:t.feedback,feedbackCheck:t.feedbackCheck}));'
		)
		assert.equal(await native!.execute('return window.__feedbackChat.failure'), null)
		evidence.turns = turns
		return turns
	}
	let turns = await send(
		'Here in this Intent, for an imaginary model railway workshop: suggest two useful labels for sorting spare parts. Keep it to two short bullets; do not save tasks or files.'
	)
	const reply = turns.find((t: any) => t.role === 'assistant')
	assert(reply?.content)
	const target = `[data-response-id="${reply.id}"]`
	turns = await send(
		'That answer was really helpful and easy to understand. Exactly what I needed!'
	)
	await wait(
		`document.querySelector('${target} [aria-label="Helpful response"]')?.getAttribute('aria-pressed')==='true'`
	)
	await wait(`document.querySelector('${target}')?.textContent.includes('Automatically detected')`)
	const get = () =>
		evaluate(
			`return await window.__TAURI_INTERNALS__.invoke('intent_message_get',{messageId:${JSON.stringify(reply.id)}})`
		)
	let stored = await get()
	assert.equal(stored.feedback.vote, 'up')
	assert(stored.feedback.inferredFrom)
	assert.equal(stored.feedback.reason, '')
	const source = await evaluate(
		`return await window.__TAURI_INTERNALS__.invoke('intent_message_get',{messageId:${JSON.stringify(stored.feedback.inferredFrom)}})`
	)
	assert.match(source.content, /helpful/)
	evidence.checks.push('Automatic vote has a saved source utterance and is visibly identified')
	await writeFile(`${out}/automatic.png`, Buffer.from(await native.screenshot(), 'base64'))
	await click(`${target} [aria-label="Helpful response"]`)
	await wait(
		`document.querySelector('${target} [aria-label="Helpful response"]')?.getAttribute('aria-pressed')==='false' && !document.querySelector('${target}')?.textContent.includes('Saving')`
	)
	stored = await get()
	assert.equal(stored.feedback.vote, null)
	assert(!stored.feedback.inferredFrom)
	await click(`${target} [aria-label="Unhelpful response"]`)
	await wait(`document.querySelector('${target}')?.textContent.includes('Add a reason')`)
	await click(`${target} .reason-link`)
	await native.type(
		await native.find(`${target} textarea`),
		'Please include an example from the fictional workshop.'
	)
	await click(`${target} button[type="submit"]`)
	await wait(
		`!document.querySelector('${target} textarea') && !document.querySelector('${target}')?.textContent.includes('Saving')`
	)
	stored = await get()
	assert.equal(stored.feedback.vote, 'down')
	assert.match(stored.feedback.reason, /fictional workshop/)
	evidence.checks.push('Unpress, change vote and inline reason are durable manual choices')
	// Explicitly praise the older first answer again: manual annotation must still win.
	await send('The first answer about the two sorting labels was excellent. Very helpful!')
	stored = await get()
	assert.equal(stored.feedback.vote, 'down')
	assert.match(stored.feedback.reason, /fictional workshop/)
	await native.navigate('http://127.0.0.1:1457/dashboard')
	await native.waitForBodyText('Process on', 45000)
	await attach()
	await wait(
		`document.querySelector('${target} [aria-label="Unhelpful response"]')?.getAttribute('aria-pressed')==='true'`
	)
	await click(`${target} .reason-link`)
	assert.match(
		await native.execute<string>(`return document.querySelector('${target} textarea').value`),
		/fictional workshop/
	)
	await writeFile(`${out}/manual-reloaded.png`, Buffer.from(await native.screenshot(), 'base64'))
	evidence.checks.push('Manual feedback survives later sentiment and full webview reload')
	evidence.passed = true
	evidence.finishedAt = new Date().toISOString()
	console.log(JSON.stringify({ output: out, passed: true, checks: evidence.checks }))
} catch (error) {
	evidence.error = String(error)
	evidence.body = await native?.bodyText().catch(String)
	evidence.routingErrors = await native?.execute('return window.__routingProof').catch(String)
	evidence.input = await native?.execute('return window.__feedbackChat?.input.items').catch(String)
	if (native)
		await native
			.screenshot()
			.then((data) => writeFile(`${out}/failure.png`, Buffer.from(data, 'base64')))
			.catch(() => {})
	throw error
} finally {
	await writeFile(`${out}/evidence.json`, JSON.stringify(evidence, null, 2))
	await native?.close()
	await browser.close()
}
