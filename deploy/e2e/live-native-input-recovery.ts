/** Recovered drafts through real native storage, Qwen routing and clickable UI.
 * Only independently invented inputs in the explicitly supplied synthetic account. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { TauriSession } from './tauri-driver'

const [binary, privateSession, environmentId] = process.argv.slice(2)
assert(binary && privateSession && environmentId)
const session = JSON.parse(await readFile(privateSession, 'utf8'))
assert.equal(session.identity, 'http://localhost:13100')
const originUrl = process.env.NATIVE_RECOVERY_ORIGIN ?? 'http://127.0.0.1:1457'
assert(['http://127.0.0.1:1457', 'http://127.0.0.1:1451'].includes(originUrl))
const out = await mkdtemp('/tmp/aven-native-input-recovery-')
const evidence: any = {
	synthetic: true,
	environmentId,
	originUrl,
	passed: false,
	checks: [],
	fingerprints: {}
}
for (const path of [
	'app/src/lib/chat/input-inbox.svelte.ts',
	'app/src/lib/chat/input-inbox-controller.ts',
	'app/src/lib/chat/input-drafts.ts',
	'app/src/lib/intents/InputRouting.svelte',
	'deploy/e2e/live-native-input-recovery.ts'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(new URL(`../../${path}`, import.meta.url)))
		.digest('hex')
const browser = await chromium.launch({ headless: true })
let native: TauriSession | undefined
async function evaluate(body: string) {
	await native!.execute(
		`window.__recoveryProbe=null;(async()=>{${body}})().then(value=>window.__recoveryProbe={value},e=>window.__recoveryProbe={error:String(e)});`
	)
	for (let i = 0; i < 300; i++) {
		const result = await native!.execute<any>('return window.__recoveryProbe')
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
		await Bun.sleep(100)
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
const drafts = () => evaluate(`return await window.__TAURI_INTERNALS__.invoke('input_drafts_load')`)
async function waitDrafts(count: number) {
	for (let i = 0; i < 100; i++) {
		const saved = await drafts()
		if (saved.items.length === count) {
			await wait(
				count
					? `document.querySelector('[data-input-id="${saved.items[0].id}"]')`
					: `!document.querySelector('[data-input-id]')`
			)
			return saved
		}
		await Bun.sleep(100)
	}
	throw Error(`Recovered tray did not persist ${count} pending drafts`)
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
	await wait(`document.body.textContent.includes('Process on')`, 45000)
	await evaluate(
		`return await window.__TAURI_INTERNALS__.invoke('auth_environment_select',{environmentId:${JSON.stringify(environmentId)}})`
	)
	await native.navigate(`${originUrl}/dashboard`)
	await native.waitForBodyText('Process on', 45000)
	const origin = crypto.randomUUID(),
		destination = crypto.randomUUID()
	evidence.intentIds = [origin, destination]
	const intents = [
		{ id: origin, title: 'Fictional ceramic workshop' },
		{ id: destination, title: 'Fictional community garden' }
	]
	for (const item of intents)
		await evaluate(
			`return await window.__TAURI_INTERNALS__.invoke('intent_create',{intent:{...${JSON.stringify(item)},intentType:'conversation',sourceLabel:'Chat'}})`
		)
	const text =
		'Which seedlings would be easy for beginners to grow indoors? Please give two short suggestions, without saving tasks or files.'
	const decision = await evaluate(
		`return await window.__TAURI_INTERNALS__.invoke('input_decision',{request:${JSON.stringify({
			kind: 'route',
			modelId: 'deepseek/deepseek-v4-flash-0731',
			text,
			locale: 'en-GB',
			context: { selectedId: origin, intents, recent: [] }
		})}});`
	)
	const route = decision.decision
	assert(
		route.target && (route.target.kind === 'new' || route.target.id === destination),
		'The unrelated input needs a different destination suggestion'
	)
	assert.equal(route.fit, false)
	assert.equal(route.explicit, false)
	evidence.route = route
	const pending = Array.from({ length: 6 }, (_, i) => ({
		id: crypto.randomUUID(),
		revision: 1,
		text: `${text}\nDraft ${i + 1}.`,
		originalText: `${text}\nDraft ${i + 1}.`,
		corrections: [],
		locale: 'en-GB',
		createdAt: new Date().toISOString(),
		defaultId: origin,
		selectionEpoch: 0,
		stage: 'choice',
		intents,
		suggestion: route.target,
		topic: route.topic,
		responseMode: route.responseMode,
		error: null,
		confirmed: false,
		decisionId: crypto.randomUUID()
	}))
	await evaluate(`const saved=await window.__TAURI_INTERNALS__.invoke('input_drafts_load');
    return await window.__TAURI_INTERNALS__.invoke('input_drafts_save',{scopeId:saved.scope,items:${JSON.stringify(pending)},expectedRevision:saved.revision});`)
	async function reload() {
		await native!.navigate(`${originUrl}/dashboard`)
		await native!.waitForBodyText('Process on', 45000)
		await evaluate(`window.__recoveryErrors=[];window.addEventListener('error',e=>window.__recoveryErrors.push(e.message));
      window.addEventListener('unhandledrejection',e=>window.__recoveryErrors.push(String(e.reason)));return true;`)
	}
	await reload()
	await waitDrafts(6)
	await click('[aria-label="Discard unassigned message"]')
	await waitDrafts(5)
	evidence.checks.push('Recovered draft can be discarded without deleting the other five')
	await click('[data-route-action="suggestion"]')
	await waitDrafts(4)
	await wait(
		`!document.querySelector('[aria-label="Agent working"], [aria-label="Agent queued"]')`,
		180000
	)
	const delivered = await evaluate(
		`return await window.__TAURI_INTERNALS__.invoke('intent_message_get',{messageId:${JSON.stringify(pending[1].id)}})`
	)
	assert.equal(delivered.content, pending[1].text)
	evidence.checks.push(
		'Clicking the reactive suggested destination admits the exact recovered input'
	)
	await click('[aria-label="Edit unassigned message"]')
	await waitDrafts(3)
	assert.equal(
		await native.execute('return document.querySelector(\'[aria-label="Message Aven"]\').value'),
		pending[2].text
	)
	// Preserve the edited words while dismissing a different pending input.
	await click('[aria-label="Discard unassigned message"]')
	await waitDrafts(2)
	assert.equal(
		await native.execute('return document.querySelector(\'[aria-label="Message Aven"]\').value'),
		pending[2].text
	)
	assert.deepEqual(await native.execute('return window.__recoveryErrors'), [])
	evidence.checks.push(
		'Edit restores exact words; dismissing another pending item leaves the edited draft alone'
	)
	await writeFile(`${out}/edited-and-pending.png`, Buffer.from(await native.screenshot(), 'base64'))
	// This is a disposable test profile; clear the already asserted editable field before reload.
	await native.execute(
		`const field=document.querySelector('[aria-label="Message Aven"]');field.value='';field.dispatchEvent(new Event('input',{bubbles:true}));`
	)
	await reload()
	const retained = (await waitDrafts(2)).items.map((i: any) => i.id)
	assert.deepEqual(
		retained,
		pending.slice(4).map((i) => i.id)
	)
	for (let remaining = 1; remaining >= 0; remaining--) {
		await click('[aria-label="Discard unassigned message"]')
		await waitDrafts(remaining)
	}
	await reload()
	await waitDrafts(0)
	const stored = await evaluate(
		`return await window.__TAURI_INTERNALS__.invoke('input_drafts_load')`
	)
	assert.deepEqual(stored.items, [])
	assert.deepEqual(await native.execute('return window.__recoveryErrors'), [])
	evidence.checks.push('Only untouched drafts recover; dismissals stay removed after reload')
	evidence.passed = true
	console.log(JSON.stringify({ output: out, passed: true, checks: evidence.checks }))
} catch (error) {
	evidence.error = String(error)
	evidence.input = native ? await drafts().catch(String) : undefined
	evidence.errors = await native?.execute('return window.__recoveryErrors').catch(String)
	evidence.body = await native?.bodyText().catch(String)
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
