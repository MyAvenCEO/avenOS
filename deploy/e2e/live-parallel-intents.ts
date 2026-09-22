/** Native per-Intent concurrency, using real Qwen and an isolated fictional account. */
import assert from 'node:assert/strict'
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
const origin = process.env.E2E_APP_ORIGIN ?? 'http://127.0.0.1:1451'
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
const output = `/tmp/aven-live-parallel-intents/${new Date().toISOString().replaceAll(':', '-')}`
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
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function evaluate<T = any>(body: string): Promise<T> {
	await native!.execute(
		`window.__parallelResult=null;(async()=>{${body}})().then(value=>window.__parallelResult={value},error=>window.__parallelResult={error:String(error)});`
	)
	for (let i = 0; i < 600; i++) {
		const result = await native!.execute<any>('return window.__parallelResult')
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
	await native!.click(await native!.findEventually(selector))
}
async function waitFor(expression: string, timeout = 180000) {
	const until = Date.now() + timeout
	while (Date.now() < until) {
		if (await native!.execute(`return Boolean(${expression})`)) return
		await pause(200)
	}
	throw Error(`Timed out: ${expression}\n${await native!.bodyText()}`)
}
const a = crypto.randomUUID(),
	b = crypto.randomUUID()
const aTitle = `Fictional seed stall ${Date.now()}`
const bTitle = `Fictional lamp workshop ${Date.now()}`
const thread = (id: string) => `window.__avenWorkday.thread(${JSON.stringify(id)})`
const select = async (id: string) => {
	await waitFor('window.__avenWorkday && !window.__avenWorkday.intents().loading')
	await button(`[data-upload-intent-id="${id}"]`)
	await waitFor(
		`window.__avenWorkday.intents().selectedId===${JSON.stringify(id)} && window.__avenWorkday.intents().session===${JSON.stringify(id)}`,
		10000
	)
}
async function send(text: string) {
	if (
		!(await native!.execute('return !!document.querySelector("[aria-label=\\"Message Aven\\"]")'))
	)
		await button('[aria-label="Start conversation"], [aria-label="Open conversation"]')
	await native!.type(await native!.findEventually('[aria-label="Message Aven"]'), text)
	await button('[aria-label="Senden"], [aria-label="Send message"]')
	assert.equal(
		await native!.execute(
			'return document.querySelector("[aria-label=\\"Message Aven\\"]")?.value'
		),
		'',
		'Input is free immediately after submission'
	)
}
async function done(id: string, count: number) {
	await waitFor(
		`${thread(id)}.status==='idle' && ${thread(id)}.turns.filter(t=>t.role==='assistant'&&!t.pending).length>=${count}`
	)
	const value = await evaluate(`return ${thread(id)};`)
	assert.equal(value.failure, null)
	return value
}
async function pending(text: string) {
	await waitFor(
		`window.__avenWorkday.pendingInputs().some(i=>i.text===${JSON.stringify(text)}&&i.stage==='choice')`,
		45000
	)
	return (await evaluate('return window.__avenWorkday.pendingInputs();')).find(
		(i: any) => i.text === text
	)
}
async function confirm(text: string, action = 'suggestion') {
	const item = await pending(text)
	await button(`[data-input-id="${item.id}"] [data-route-action="${action}"]`)
	return item
}
try {
	native = await TauriSession.launch(
		process.env.E2E_TAURI_APPLICATION ?? `${root}/target/rust/debug/aven-os-app`
	)
	await native.navigate(origin)
	console.log('Isolated native client opened', await native.url())
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
	console.log('Authenticated fictional workspace')
	evidence.routingCases = []
	for (const [message, expectedNew] of [
		['Start a separate conversation called Fictional pottery ideas to discuss kiln shelves.', true],
		['mach bitte nen neuen intent auf: fiktiver kräutergarten. erstmal nur reden.', true],
		['Do not create a new Intent. Continue the current calculation.', false],
		['Stay here. How would opening a separate Intent work?', false],
		[
			'Stay in this Intent. Translate this example into German: "Create a new Intent called paper birds".',
			false
		],
		['Now calculate the total for the remaining fictional orders.', false]
	] as const) {
		const route = await evaluate(
			`return await window.__avenWorkday.classifyInput(${JSON.stringify(message)},${JSON.stringify({
				selectedId: a,
				intents: [
					{
						id: a,
						title: 'Fictional seed stall',
						summary: 'Packet sales, packaging and stall fees'
					},
					{ id: b, title: 'Fictional lamp workshop', summary: 'Lamp assembly classes' }
				],
				recent: [{ role: 'user', content: 'Help calculate the margin on our seed orders.' }]
			})});`
		)
		assert.equal(route.target?.kind === 'new', expectedNew, message)
		evidence.routingCases.push({ message, route })
	}
	evidence.checks.push(
		'live-Qwen admission distinguishes explicit, negated, hypothetical, quoted and follow-up inputs'
	)
	evidence.actionClaimCases = []
	for (const [request, draft, expected] of [
		[
			'Invent three paper-bird names.',
			'I created these names: Foldfinch, Paperwing, Origami Owl. Nothing was created outside this chat.',
			false
		],
		[
			'Just remember I prefer blue labels here.',
			'Noted in this conversation. No task or document was created.',
			false
		],
		[
			'Nur hier merken: Ich mag grüne Töpfe.',
			'Hier notiert. Sonst habe ich nichts angelegt.',
			false
		],
		[
			'Save a task to inspect the fictional kiln.',
			'I created the task in your saved task list.',
			true
		],
		['Add a task for the fictional seed stall.', 'I will add it to your tasks now.', true]
	] as const) {
		const claims = await evaluate(
			`return await window.__avenWorkday.assessActionClaim(${JSON.stringify(request)},${JSON.stringify(draft)});`
		)
		assert.equal(claims, expected, draft)
		evidence.actionClaimCases.push({ request, draft, claims })
	}
	evidence.checks.push(
		'live-Qwen action guard preserves chat-only work and negations while rejecting false external effects'
	)
	for (const [id, title] of [
		[a, aTitle],
		[b, bTitle]
	])
		await evaluate(
			`await window.__TAURI_INTERNALS__.invoke('intent_create',{intent:{id:${JSON.stringify(id)},title:${JSON.stringify(title)},intentType:'conversation',sourceLabel:'Chat'}});`
		)
	await native.navigate(url)
	await native.waitForBodyText('Process on', 45000)
	await select(a)
	await send(
		'Stay in this Intent. Fictional seed stall: 37 packets sell for 4 EUR each. Packaging costs 19 EUR total. Calculate the sales and remainder after packaging with the calculator. Explain the calculation in six short numbered steps. Do not create anything.'
	)
	await waitFor(`${thread(a)}.status==='working'`)
	await send(
		'Continuing the seed stall: add a 7 EUR table fee. Calculate the updated remainder using the previous figures, and answer briefly. Stay here; do not create anything.'
	)
	await waitFor(`${thread(a)}.turns.some(t=>t.queued)`)
	await select(b)
	await evaluate(
		`window.dispatchEvent(new CustomEvent('aven-e2e-accepted-transcript',{detail:{text:'Stay in this Intent. Fictional lamp workshop: 9 customers each paid an all-inclusive price of 23 EUR. The workshop spent 42 EUR in total on parts; customers pay no extra for parts. Use the calculator for revenue minus expenses. Do not create anything. Answer briefly.'}}));`
	)
	await waitFor(`${thread(a)}.status==='working' && ${thread(b)}.status==='working'`)
	evidence.overlap = await evaluate(`return {a:${thread(a)},b:${thread(b)}};`)
	console.log('Two agents running; one queued follow-up')
	await evaluate('await window.__avenWorkday.interruptNarration();')
	assert.equal(
		(await evaluate(`return ${thread(a)};`)).status,
		'working',
		'Audio interruption did not stop A'
	)
	assert.equal(
		(await evaluate(`return ${thread(b)};`)).status,
		'working',
		'Audio interruption did not stop B'
	)
	evidence.a = await done(a, 2)
	evidence.b = await done(b, 1)
	console.log('Both conversations answered; queued follow-up completed')
	assert.match(evidence.a.turns.at(-1).content, /122/)
	assert.match(evidence.b.turns.at(-1).content, /165/)
	assert.equal(
		(await evaluate('return window.__avenWorkday.intents();')).selectedId,
		b,
		'Background completion never steals focus'
	)
	assert(
		!evidence.a.request.messages[0].content.includes(
			`CONVERSATION INTENT (not necessarily the current screen selection): ${b}`
		)
	)
	assert(evidence.a.request.messages[0].content.includes(a))
	assert(
		await native!.execute(
			`return !!document.querySelector('[data-upload-intent-id="${a}"] [aria-label="New reply"]')`
		)
	)
	evidence.checks.push(
		'simultaneous real-model threads',
		'FIFO queued follow-up with prior answer',
		'accepted spoken input',
		'barge-in preserves both executions',
		'pinned context and background notification'
	)
	const title = `Fictional beacon catalog ${Date.now()}`
	const create = `Create a new separate Intent named "${title}". I want to discuss organizing lighthouse postcards there. Only create that Intent and ask what I want to do; do not research or create tasks.`
	await send(create)
	await send(
		'For that new postcard Intent: just remember that my fictional collection has a green binder. Reply briefly; take no action.'
	)
	const stagedNew = await pending(create)
	evidence.stagedNew = stagedNew
	assert(!(await evaluate(`return ${thread(b)};`)).turns.some((t: any) => t.content === create))
	assert(
		!(await evaluate('return window.__avenWorkday.intents();')).items.some(
			(i: any) => i.title === title
		)
	)
	const beforeAssignment = await evaluate(
		`return await window.__TAURI_INTERNALS__.invoke('intent_get',{intentId:${JSON.stringify(b)}});`
	)
	assert(!beforeAssignment.contributions.some((c: any) => c.text === create))
	await writeFile(
		`${output}/native-routing-choice.png`,
		Buffer.from(await native.screenshot(), 'base64')
	)
	await select(a)
	await button(`[data-input-id="${stagedNew.id}"] [data-route-action="suggestion"]`)
	await waitFor(`window.__avenWorkday.intents().items.some(i=>i.title===${JSON.stringify(title)})`)
	const created = (await evaluate('return window.__avenWorkday.intents();')).items.find(
		(i: any) => i.title === title
	).id
	evidence.created = await done(created, 2)
	console.log('Created-Intent conversation and immediate follow-up completed')
	assert.equal(
		(await evaluate('return window.__avenWorkday.intents();')).selectedId,
		a,
		'Background routing cannot steal focus'
	)
	assert(evidence.created.turns.some((t: any) => t.content === create))
	assert.match(evidence.created.turns.at(-1).content, /green|grün/i)
	assert(!(await evaluate(`return ${thread(b)};`)).turns.some((t: any) => t.content === create))
	evidence.checks.push(
		'new Intent carries initiating contribution and queued follow-up without stealing focus'
	)
	await send(
		'Give 150 different short fictional names for seed packets, numbered. Stay in this Intent and do not use tools.'
	)
	await waitFor(`${thread(a)}.status==='working'`)
	await select(b)
	await send(
		'Stay here. Suggest three short fictional names for this lamp workshop; no tools and no new Intent.'
	)
	await waitFor(`${thread(b)}.status==='working'`)
	await select(a)
	await button('[aria-label="Stop response in this Intent"]')
	await waitFor(`${thread(a)}.status==='idle'`)
	evidence.bAfterStop = await done(b, 2)
	evidence.checks.push('explicit cancellation in A leaves B running')
	// Reproduce the actual queue defect without delaying or mocking the model.
	await send(
		'In this Intent, write 250 numbered fictional seed names, each with a short invented description. Do not create anything and do not use tools.'
	)
	await waitFor(`${thread(a)}.status==='working'`)
	await send(
		'After those names, choose your favourite and explain it in one sentence. Stay in this Intent.'
	)
	await waitFor(`${thread(a)}.turns.some(t=>t.queued)`)
	const independentTitle = `Fictional pottery planner ${Date.now()}`
	const breakout = `Create a new Intent named "${independentTitle}" to explore a planner for a fictional pottery workshop. Ask which planning problem I want to tackle first. Do not build anything yet.`
	await send(breakout)
	await confirm(breakout)
	await waitFor(
		`window.__avenWorkday.intents().items.some(i=>i.title===${JSON.stringify(independentTitle)})`
	)
	const independent = (await evaluate('return window.__avenWorkday.intents();')).items.find(
		(i: any) => i.title === independentTitle
	).id
	await waitFor(`${thread(independent)}.status==='working'`)
	evidence.breakout = await evaluate(
		`return {origin:${thread(a)},separate:${thread(independent)}};`
	)
	assert.equal(
		evidence.breakout.origin.status,
		'working',
		'New Intent starts before the running response ends'
	)
	assert(
		evidence.breakout.origin.turns.some((t: any) => t.queued),
		'Earlier ordinary follow-up stays queued in its original Intent'
	)
	assert(!evidence.breakout.origin.turns.some((t: any) => t.content === breakout))
	assert.equal((await evaluate('return window.__avenWorkday.intents();')).selectedId, independent)
	console.log('New-Intent request bypassed a running response and its queued follow-up')
	evidence.independent = await done(independent, 1)
	console.log('Independent new Intent answered')
	assert.equal(
		evidence.independent.turns
			.flatMap((t: any) => t.calls ?? [])
			.filter((c: any) => c.name === 'intent_create').length,
		1
	)
	await select(a)
	if ((await evaluate(`return ${thread(a)};`)).status === 'working')
		await button('[aria-label="Stop response in this Intent"]')
	await waitFor(`${thread(a)}.status==='idle'`, 180000)
	evidence.checks.push(
		'explicit new Intent bypasses running and queued work without duplicating creation'
	)
	for (const id of [a, b, created, independent]) {
		await waitFor(`${thread(id)}.turns.filter(t=>t.content && !t.queued).every(t=>t.persisted)`)
		const saved = await evaluate(
			`return await window.__TAURI_INTERNALS__.invoke('intent_get',{intentId:${JSON.stringify(id)}});`
		)
		evidence.saved ??= []
		evidence.saved.push(saved)
		const users = saved.contributions.filter((c: any) => c.contributorKind === 'human')
		assert.equal(new Set(users.map((c: any) => c.id)).size, users.length)
	}
	console.log('Settled histories persisted')
	await native.navigate(url)
	await native.waitForBodyText('Process on', 45000)
	await select(created)
	assert.match(
		(await evaluate('return window.__avenWorkday.state();')).turns.at(-1).content,
		/green|grün/i
	)
	evidence.checks.push('customer DB persistence and reload retain routed conversation')
	// A wrong-screen contribution stays in the input widget, including accepted speech.
	await select(a)
	const lampQuestion = `For the Intent "${bTitle}", brainstorm two imaginary shade shapes. No tools or tasks, just ideas.`
	await send(lampQuestion)
	const mismatch = await pending(lampQuestion)
	evidence.mismatch = mismatch
	assert.equal(mismatch.suggestion.id, b)
	assert(
		!(await evaluate(`return ${thread(a)};`)).turns.some((t: any) => t.content === lampQuestion)
	)
	assert(
		!(await evaluate(`return ${thread(b)};`)).turns.some((t: any) => t.content === lampQuestion)
	)
	const before = await evaluate(
		`return await window.__TAURI_INTERNALS__.invoke('intent_get',{intentId:${JSON.stringify(a)}});`
	)
	assert(!before.contributions.some((c: any) => c.text === lampQuestion))
	await select(b)
	let bCount = (await evaluate(`return ${thread(b)};`)).turns.filter(
		(t: any) => t.role === 'assistant'
	).length
	await send('Stay here. Suggest one whimsical lamp name, no tools or actions.')
	await done(b, ++bCount)
	assert(
		(await evaluate('return window.__avenWorkday.pendingInputs();')).some(
			(i: any) => i.id === mismatch.id
		)
	)
	await native.execute(
		`const button=document.querySelector('[data-input-id="${mismatch.id}"] [data-route-action="suggestion"]');button.click();button.click();`
	)
	const moved = await done(b, ++bCount)
	assert.equal(moved.turns.filter((t: any) => t.content === lampQuestion).length, 1)
	evidence.checks.push(
		'misfit remains only in input and absent from DB; another Intent proceeds; confirmation double tap sends exactly once'
	)
	await select(a)
	const keep = `For the Intent "${bTitle}", suggest one new shade shape. Answer briefly, without tools or actions.`
	let aCount = (await evaluate(`return ${thread(a)};`)).turns.filter(
		(t: any) => t.role === 'assistant'
	).length
	await send(keep)
	await confirm(keep, 'keep')
	const kept = await done(a, ++aCount)
	assert(kept.turns.some((t: any) => t.content === keep))
	evidence.checks.push(
		'user can override the suggested move and keep a contribution in its default Intent'
	)
	const manual = `Open a new Intent named "Fictional lantern colours ${Date.now()}" to brainstorm lamps. No tools after opening, just a short question.`
	await send(manual)
	const pick = await pending(manual)
	await button(`[data-input-id="${pick.id}"] [data-route-action="choose"]`)
	await native.type(await native.findEventually('[aria-label="Search Intents"]'), bTitle)
	await button(`[data-input-id="${pick.id}"] .search-row button`)
	await waitFor(
		`!document.querySelector('[data-input-id="${pick.id}"] .search-row button')?.disabled`
	)
	await button(`[data-input-id="${pick.id}"] [data-route-target="${b}"]`)
	evidence.manualDestination = await done(b, ++bCount)
	assert.doesNotMatch(
		evidence.manualDestination.turns.at(-1).content,
		/can't open|doesn.t exist|does not exist|no intent.creation (tool|capability)|create the Intent yourself|needs? to (be )?creat/i
	)
	assert(
		evidence.manualDestination.request.messages[0].content.includes('NO new Intent was created')
	)
	assert(
		!(evidence.manualDestination.turns.at(-1).calls ?? []).some((c: any) =>
			['intent_create', 'intent_switch'].includes(c.name)
		)
	)
	assert(
		!(await evaluate('return window.__avenWorkday.intents();')).items.some(
			(i: any) => i.title === pick.suggestion.title
		)
	)
	const routedContribution = evidence.manualDestination.turns.find((t: any) => t.content === manual)
	assert.deepEqual(routedContribution.inputAdmission, {
		intentId: b,
		destination: 'existing',
		confirmed: true
	})
	const persistedChoice = await evaluate(
		`return await window.__TAURI_INTERNALS__.invoke('intent_get',{intentId:${JSON.stringify(b)}});`
	)
	assert.deepEqual(
		persistedChoice.contributions.find((c: any) => c.id === routedContribution.id)?.payload
			.inputAdmission,
		routedContribution.inputAdmission
	)
	evidence.checks.push(
		'searchable destination picker overrides a proposed new Intent; original text and later human choice are both persisted and the agent continues the topic'
	)
	await native.navigate(url)
	await native.waitForBodyText('Process on', 45000)
	await select(b)
	assert.deepEqual(
		(await evaluate(`return ${thread(b)};`)).turns.find((t: any) => t.id === routedContribution.id)
			?.inputAdmission,
		routedContribution.inputAdmission
	)
	await send(
		'Stay here. Continue that brainstorm: suggest two colour pairings. No tools, no new Intent.'
	)
	evidence.restoredChoice = await done(b, ++bCount)
	assert(
		evidence.restoredChoice.request.messages.some(
			(m: any) =>
				m.role === 'user' &&
				m.content.includes(manual) &&
				m.content.includes('user chose to send it to this EXISTING Intent instead')
		)
	)
	assert.doesNotMatch(
		evidence.restoredChoice.turns.at(-1).content,
		/can't open|doesn.t exist|does not exist|no intent.creation (tool|capability)|create the Intent yourself|needs? to (be )?creat/i
	)
	evidence.checks.push(
		'reload retains the confirmed routing decision in both displayed history metadata and the next real-Qwen request'
	)
	await select(a)
	const spokenMismatch = `Please move this discussion to "${bTitle}" and compare two imaginary lamp shades. No actions, just ideas.`
	await evaluate(
		`window.dispatchEvent(new CustomEvent('aven-e2e-accepted-transcript',{detail:{text:${JSON.stringify(spokenMismatch)}}}));`
	)
	const spoken = await pending(spokenMismatch)
	assert.equal(spoken.suggestion.id, b)
	await native.type(
		await native.findEventually('[aria-label="Message Aven"]'),
		'Unsent seed note. '
	)
	await button(`[data-input-id="${spoken.id}"] [aria-label="Edit unassigned message"]`)
	const recovered = await native.execute<string>(
		'return document.querySelector("[aria-label=\\"Message Aven\\"]").value'
	)
	assert(recovered.includes('Unsent seed note.') && recovered.includes(spokenMismatch))
	assert(
		!(await evaluate(`return ${thread(a)};`)).turns.some((t: any) => t.content === spokenMismatch)
	)
	await native.execute(
		'const field=document.querySelector("[aria-label=\\"Message Aven\\"]");field.value="";field.dispatchEvent(new Event("input",{bubbles:true}));'
	)
	evidence.checks.push(
		'accepted voice uses the same destination gate; editing retains both the staged contribution and newer draft'
	)
	// Real failure, not a mock: the destination disappears after Qwen recommends it.
	await waitFor(`${thread(b)}.turns.filter(t=>t.content&&!t.queued).every(t=>t.persisted)`)
	const vanishedMessage = `Please continue in "${bTitle}". Suggest a fictional shade colour; take no action.`
	await send(vanishedMessage)
	const vanished = await pending(vanishedMessage)
	assert.equal(vanished.suggestion.id, b)
	await evaluate(
		`const intent=await window.__TAURI_INTERNALS__.invoke('intent_get',{intentId:${JSON.stringify(b)}});await window.__TAURI_INTERNALS__.invoke('intent_delete',{intentId:intent.id,command:{id:intent.id,expectedVersion:intent.version}});`
	)
	await button(`[data-input-id="${vanished.id}"] [data-route-action="suggestion"]`)
	await waitFor(
		`window.__avenWorkday.pendingInputs().some(i=>i.id==='${vanished.id}'&&i.stage==='failed')`
	)
	assert(
		!(await evaluate(`return ${thread(a)};`)).turns.some((t: any) => t.content === vanishedMessage)
	)
	assert(
		!(await evaluate(`return ${thread(b)};`)).turns.some((t: any) => t.content === vanishedMessage)
	)
	await button(`[data-input-id="${vanished.id}"] [data-route-action="retry"]`)
	await waitFor(
		`window.__avenWorkday.pendingInputs().some(i=>i.id==='${vanished.id}'&&i.stage==='failed')`
	)
	evidence.failedAssignment = (await evaluate('return window.__avenWorkday.pendingInputs();')).find(
		(i: any) => i.id === vanished.id
	)
	await button(`[data-input-id="${vanished.id}"] [aria-label="Discard unassigned message"]`)
	evidence.checks.push(
		'a real deleted-destination failure and retry retain the message only in input; discard releases its admission lane'
	)
	await send(
		'Stay in this Intent. Use knowledge_query once with collection documents and view summary to establish the size of the available document pool. Include a short purpose explaining that this is preparation for later research, not completed research. Do not read any files or search for values. Briefly report the count and its limits.'
	)
	evidence.inventory = await done(a, ++aCount)
	const inventoryCalls = evidence.inventory.turns.at(-1).calls ?? []
	const inventory = inventoryCalls.find(
		(c: any) => c.name === 'knowledge_query' && c.status === 'completed'
	)
	assert(inventory, 'Real Qwen queried the actual synthetic document pool')
	const query = JSON.parse(inventory.result).outputs.result
	assert(query.query.purpose?.length > 5)
	assert.equal(query.query.collection, 'documents')
	assert(!inventoryCalls.some((c: any) => c.name === 'workspace_read'))
	await native.waitForBodyText(
		'Gezählt wurden Dateien, nicht Fundstellen oder extrahierte Werte.',
		10000
	)
	await writeFile(
		`${output}/native-inventory-card.png`,
		Buffer.from(await native.screenshot(), 'base64')
	)
	evidence.checks.push(
		'real-Qwen inventory card names its purpose and explicitly distinguishes document counts from inspected sources or extracted values'
	)
	// Capture the routed conversation after reload, not the long streaming stress response.
	await select(created)
	await writeFile(`${output}/native-threads.png`, Buffer.from(await native.screenshot(), 'base64'))
	console.log('Reload verified; native screenshot saved')
	evidence.completedAt = new Date().toISOString()
} catch (error) {
	evidence.error = String(error)
	if (native) evidence.body = await native.bodyText().catch(() => null)
	throw error
} finally {
	await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2))
	console.log(output)
	await native?.close()
	await browser.close()
}
