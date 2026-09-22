/** Native UI tools + real authenticated Qwen answer verification. Synthetic account only. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { nativeScreenshot } from './native-screenshot'
import { TauriSession } from './tauri-driver'

const [binary, privateSession, environmentId] = process.argv.slice(2)
assert(binary && privateSession && environmentId)
const session = JSON.parse(await readFile(privateSession, 'utf8'))
assert.equal(session.identity, 'http://localhost:13100')
const output = await mkdtemp('/tmp/aven-native-receipts-')
const capture = process.env.E2E_NATIVE_CAPTURE ?? 'webdriver'
assert(['webdriver', 'xvfb'].includes(capture))
const evidence: any = {
	synthetic: true,
	environmentId,
	startedAt: new Date().toISOString(),
	passed: false,
	cases: [],
	fingerprints: {},
	capture,
	scope:
		'Native software-rendered client, device sign-in, input admission, authenticated local Qwen gateway, actual UI Actors, calculation and answer review. Not a full native release/voice gate.'
}
for (const path of [
	'deploy/e2e/live-native-receipts.ts',
	'libs/aven-chat-engine/src/research.ts',
	'libs/aven-chat-engine/src/tool-result-evidence.ts',
	'libs/aven-productivity/src/evidence.ts',
	'libs/aven-chat-engine/src/restored-history.ts',
	'libs/aven-actors/src/calculation.ts',
	'app/src/lib/actors/windows.ts',
	'app/src/lib/actors/window.actor.svelte.ts',
	'app/src/lib/actors/TaskWindow.svelte',
	'app/src/lib/intents/IntentsPlaceholder.svelte'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
const browser = await chromium.launch({ headless: true })
let native: TauriSession | undefined
async function screenshot() {
	return nativeScreenshot(native!)
}
async function evaluate(body: string) {
	await native!.execute(
		`window.__receiptProbe=null;(async()=>{${body}})().then(value=>window.__receiptProbe={value},e=>window.__receiptProbe={error:String(e)});`
	)
	for (let i = 0; i < 300; i++) {
		const result = await native!.execute<any>('return window.__receiptProbe')
		if (result?.error) throw Error(result.error)
		if (result) return result.value
		await Bun.sleep(100)
	}
	throw Error('Native evaluation timed out')
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
	const id = randomUUID()
	evidence.intentId = id
	const taskTitle = `Prepare fictional frame colour samples ${id.slice(0, 8)}`
	evidence.createdTaskTitle = taskTitle
	await evaluate(
		`return await window.__TAURI_INTERNALS__.invoke('intent_create',{intent:{id:${JSON.stringify(id)},title:'Fictional framing workshop screens',intentType:'conversation',sourceLabel:'Chat'}})`
	)
	await evaluate(`const {chatActor}=await import('/src/lib/actors/chat.actor.svelte.ts');
    const {intents}=await import('/src/lib/intents/intents.svelte.ts');
    const {refreshIntent}=await import('/src/lib/artifacts/ingest.svelte.ts');
    await refreshIntent(${JSON.stringify(id)});intents.select(${JSON.stringify(id)});
    window.__receiptChat=chatActor.core;return true;`)
	evidence.calculationContract = await evaluate(
		`const {bus}=await import('/src/lib/actors/bus.ts'); return bus.toolSpecs().find(s=>s.name==='calculate');`
	)
	await writeFile(`${output}/ready.png`, await screenshot())
	for (const scenario of [
		{
			tool: 'list_window_toggle',
			view: 'list',
			number: '204',
			text: 'Here in this Intent: for an imaginary framing workshop, calculate 12 sheets at 17 EUR each, then open the Todos view on screen. Do not create or change any tasks. Give a brief confirmation with the total.'
		},
		{
			tool: 'board_window_toggle',
			view: 'board',
			number: '91',
			text: 'Berechne hier 7 mal 13 und zeig mir danach das Kanban Board. Keine Aufgaben anlegen oder ändern. Bestätige kurz das Ergebnis und die Ansicht.'
		},
		{
			tool: 'stream_show',
			view: 'stream',
			number: '48',
			text: 'Here, calculate 6 times 8 and return to the activity stream on screen. Do not change saved data; confirm briefly.'
		}
	]) {
		const count = await native.execute<number>('return window.__receiptChat.turns.length')
		if (
			!(await native.execute('return !!document.querySelector(arguments[0])', [
				'[aria-label="Message Aven"]'
			]))
		)
			await click('[aria-label="Start conversation"]')
		await native.type(await native.findEventually('[aria-label="Message Aven"]'), scenario.text)
		await click('[aria-label="Senden"], [aria-label="Send message"]')
		await wait(
			`window.__receiptChat.input.items.some(i=>i.stage==='failed'||i.stage==='choice') || (window.__receiptChat.turns.length>${count} && !window.__receiptChat.working && !window.__receiptChat.input.items.length && window.__receiptChat.turns.filter(t=>t.role==='assistant').every(t=>t.persisted))`,
			240000
		)
		const report =
			await evaluate(`const {listWindow,boardWindow}=await import('/src/lib/actors/windows.ts');
      return {input:window.__receiptChat.input.items, failure:window.__receiptChat.failure,
      turns:window.__receiptChat.turns, list:listWindow.open, board:boardWindow.open,
      diagnostics:window.__receiptChat.diagnostics};`)
		evidence.cases.push({ ...scenario, ...report })
		await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 })
		assert.equal(report.input.length, 0)
		assert.equal(report.failure, null)
		const reply = report.turns.at(-1)
		assert.equal(reply.role, 'assistant')
		assert(reply.content.includes(scenario.number))
		const call = reply.calls.find((c: any) => c.name === scenario.tool)
		assert(call && JSON.parse(call.result).ok === true)
		assert(reply.calls.some((c: any) => c.name === 'calculate'))
		// Qualify receipt correctness separately from first-attempt tool fluency.
		// A rejected pure calculation can recover, but remains a reported UX failure;
		// UI failures, unknown outcomes and repeated rejection still fail this journey.
		const rejected = reply.calls.filter((c: any) => c.status !== 'completed')
		assert(
			rejected.length <= 1 &&
				rejected.every(
					(c: any) =>
						c.name === 'calculate' && c.status === 'failed' && JSON.parse(c.result).ok === false
				)
		)
		assert(
			reply.calls.some(
				(c: any) =>
					c.name === 'calculate' &&
					c.status === 'completed' &&
					JSON.parse(c.result).outputs.calculation.result.value === scenario.number
			)
		)
		evidence.avoidableRejectedCalls = (evidence.avoidableRejectedCalls ?? 0) + rejected.length
		assert.equal(report.list, scenario.view === 'list')
		assert.equal(report.board, scenario.view === 'board')
		if (
			await native.execute(`return !!document.querySelector('[aria-label="Close conversation"]')`)
		)
			await click('[aria-label="Close conversation"]')
		if (scenario.view !== 'stream') {
			await wait(
				`document.querySelector('.task-window[aria-busy="false"]') && !document.querySelector('.task-error')`
			)
			assert(!(await native.bodyText()).includes('has no view to render'))
			assert(
				await native.execute(
					`return !!document.querySelector('.task-window form input') && !!document.querySelector('.task-window nav input[type="checkbox"]')`
				)
			)
			// Actual controls and persisted data, not just an Actor's "open" flag.
			if (scenario.view === 'list') {
				await native.type(await native.find('.task-window form input'), taskTitle)
				await click('.task-window form button')
				await wait(
					`Array.from(document.querySelectorAll('.task-list .task-title')).some(e=>e.textContent===${JSON.stringify(taskTitle)}) && !document.querySelector('.task-window[aria-busy="true"]') && !document.querySelector('.task-error')`
				)
			} else {
				assert.equal(
					await native.execute(`return document.querySelectorAll('.task-board > section').length`),
					3
				)
				assert.equal(
					await native.execute(
						`return Array.from(document.querySelectorAll('.task-board .task-title')).filter(e=>e.textContent===${JSON.stringify(taskTitle)}).length`
					),
					1
				)
			}
		} else
			assert.equal(
				await native.execute(`return document.querySelectorAll('.task-window').length`),
				0
			)
		const stored = await evaluate(
			`return await window.__TAURI_INTERNALS__.invoke('intent_message_get',{messageId:${JSON.stringify(reply.id)}})`
		)
		assert.equal(stored.content, reply.content)
		await writeFile(`${output}/${scenario.view}.png`, await screenshot())
		console.log(
			JSON.stringify({
				view: scenario.view,
				passed: true,
				avoidableRejectedCalls: rejected.length,
				reply: reply.content
			})
		)
	}
	evidence.passed = true
	evidence.firstAttemptQualityPassed = evidence.avoidableRejectedCalls === 0
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	await native?.close()
	await browser.close()
	evidence.finishedAt = new Date().toISOString()
	await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 })
	console.log(`Evidence: ${output}/evidence.json`)
}
