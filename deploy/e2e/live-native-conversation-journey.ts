/** Production bundled UI, authenticated native IPC, real gateway/Qwen and SQL.
 * The caller owns a fresh split stack and authorizes only its synthetic account. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { liveNativeContextBoundaries } from './live-native-context-boundaries'
import { nativeScreenshot } from './native-screenshot'
import type { TauriSession } from './tauri-driver'

export async function liveNativeConversationJourney(
	session: TauriSession,
	options: {
		dashboard: string
		evidencePath: string
	}
) {
	const evidence: any = {
		synthetic: true,
		passed: false,
		startedAt: new Date().toISOString(),
		checks: [],
		observations: []
	}
	const wait = async (expression: string, timeout = 180_000) => {
		const deadline = Date.now() + timeout
		while (Date.now() < deadline) {
			if (await session.execute(`return Boolean(${expression})`)) return
			await sleep(150)
		}
		throw Error(`Native condition timed out: ${expression}`)
	}
	const evaluate = async (body: string) => {
		await session.execute(
			`window.__journeyProbe=null;(async()=>{${body}})().then(value=>window.__journeyProbe={value},error=>window.__journeyProbe={error:String(error)});`
		)
		await wait('window.__journeyProbe', 30_000)
		const result = await session.execute<any>('return window.__journeyProbe')
		if (result.error) throw Error(result.error)
		return result.value
	}
	const click = async (selector: string) => {
		await session.findEventually(selector)
		await session.execute('document.querySelector(arguments[0]).scrollIntoView({block:"center"})', [
			selector
		])
		await session.click(await session.find(selector))
	}
	const state = () => session.execute<any>('return window.__avenWorkday.state()')
	const screenshot = async (name: string) => {
		const path = options.evidencePath.replace(/\.json$/, `-${name}.png`)
		await writeFile(path, await nativeScreenshot(session))
		// Diagnose compositor/native child-window artifacts in the owned test
		// display without mistaking them for a DOM layout defect or hiding them.
		if (process.env.E2E_NATIVE_CAPTURE === 'xvfb') {
			let windows: string
			try {
				windows = execFileSync('xwininfo', ['-root', '-tree'], {
					timeout: 5000,
					maxBuffer: 256 * 1024,
					encoding: 'utf8'
				})
				const popups = [
					...windows.matchAll(/^\s+(0x[\da-f]+) "aven-os-app":.*?\)\s+(\d+)x(\d+)\+/gm)
				]
					.filter(
						(match) => Number(match[2]) > 10 && Number(match[2]) < 300 && Number(match[3]) < 200
					)
					.slice(0, 4)
				for (const popup of popups)
					windows +=
						`\nPopup ${popup[1]}:\n` +
						execFileSync(
							'xprop',
							[
								'-id',
								popup[1],
								'_NET_WM_WINDOW_TYPE',
								'WM_TRANSIENT_FOR',
								'WM_CLASS',
								'WM_NAME',
								'_NET_WM_PID'
							],
							{
								timeout: 5000,
								maxBuffer: 32 * 1024,
								encoding: 'utf8'
							}
						)
			} catch (error) {
				windows = `Window inspection unavailable: ${String(error)}`
			}
			await writeFile(path.replace(/\.png$/, '-windows.txt'), windows)
		}
	}
	const selected = () => session.execute<string>('return window.__avenWorkday.intents().selectedId')
	const submit = async (text: string) => {
		if (!(await session.execute(`return !!document.querySelector('[aria-label="Message Aven"]')`)))
			await click('[aria-label="Start conversation"]')
		const field = await session.findEventually('[aria-label="Message Aven"]')
		await session.type(field, text)
		assert.equal(
			await session.execute(`return document.querySelector('[aria-label="Message Aven"]').value`),
			text
		)
		await click('[aria-label="Senden"], [aria-label="Send message"]')
	}
	const settled = async (id: string) => {
		await wait(
			`(()=>{const i=window.__avenWorkday.pendingInputs();const t=window.__avenWorkday.thread(${JSON.stringify(id)});return i.some(p=>p.stage==='failed'||p.stage==='choice')||(!i.length&&t.status==='idle'&&t.turns.some(t=>t.role==='assistant')&&t.turns.filter(t=>t.role==='assistant').every(t=>t.persisted));})()`
		)
		const pending = await session.execute<any>('return window.__avenWorkday.pendingInputs()')
		assert.deepEqual(
			pending,
			[],
			'Explicit routing must not ask an unnecessary destination question'
		)
		const value = await session.execute<any>(
			`return window.__avenWorkday.thread(${JSON.stringify(id)})`
		)
		evidence.observations.push(value)
		assert.equal(value.failure, null)
		assert(value.turns.every((t: any) => !t.failed))
		return value
	}
	const readMessage = async (id: string) => {
		// Native reads refresh the short-lived token just like the user's session.
		return evaluate(
			`return await window.__TAURI_INTERNALS__.invoke('intent_message_get',{messageId:${JSON.stringify(id)}})`
		)
	}
	try {
		const id = randomUUID()
		evidence.originId = id
		await evaluate(
			`return await window.__TAURI_INTERNALS__.invoke('intent_create',{intent:{id:${JSON.stringify(id)},title:'Fictional craft shelves',intentType:'conversation',sourceLabel:'Chat'}})`
		)
		await session.navigate(options.dashboard)
		await wait('window.__avenWorkday', 45_000)
		await click(`button[data-upload-intent-id="${id}"]`)
		await wait(`window.__avenWorkday.intents().selectedId===${JSON.stringify(id)}`)
		await submit(
			'Here in this Intent: propose two short labels for an imaginary craft cupboard, one for brushes and one for paint. Our display is called Lantern Garden. Just answer; do not save tasks or files.'
		)
		await wait('window.__avenWorkday.state().turns.some(t=>t.role==="assistant")')
		let result = await settled(id)
		const first = result.turns.find((t: any) => t.role === 'assistant')
		assert(first.content.trim())
		await submit('Sehr gut erklärt, genau solche kurzen Namen habe ich gebraucht!')
		await wait(`window.__avenWorkday.state().turns.filter(t=>t.role==='assistant').length>=2`)
		await settled(id)
		const target = `[data-response-id="${first.id}"]`
		await wait(
			`document.querySelector('${target} [aria-label="Helpful response"]')?.getAttribute('aria-pressed')==='true'`
		)
		let stored = await readMessage(first.id)
		assert.equal(stored.feedback.vote, 'up')
		assert(stored.feedback.inferredFrom)
		evidence.checks.push(
			'Real German feedback through routing/native admission is saved against the exact English reply'
		)
		await click(`${target} [aria-label="Helpful response"]`)
		await wait(
			`document.querySelector('${target} [aria-label="Helpful response"]')?.getAttribute('aria-pressed')==='false'&&!document.querySelector('${target}')?.textContent.includes('Saving')`
		)
		await click(`${target} [aria-label="Unhelpful response"]`)
		await click(`${target} .reason-link`)
		await session.type(
			await session.find(`${target} textarea`),
			'I would prefer labels suitable for a child to read.'
		)
		await click(`${target} button[type="submit"]`)
		await wait(
			`!document.querySelector('${target} textarea')&&!document.querySelector('${target}')?.textContent.includes('Saving')`
		)
		stored = await readMessage(first.id)
		assert.equal(stored.feedback.vote, 'down')
		assert.match(stored.feedback.reason, /child/)
		assert(!stored.feedback.inferredFrom)
		await session.navigate(options.dashboard)
		await wait('window.__avenWorkday', 45_000)
		await click(`button[data-upload-intent-id="${id}"]`)
		await wait(
			`document.querySelector('${target} [aria-label="Unhelpful response"]')?.getAttribute('aria-pressed')==='true'`
		)
		const detail = await evaluate(
			`return await window.__TAURI_INTERNALS__.invoke('intent_get',{intentId:${JSON.stringify(id)}})`
		)
		const metrics = detail.contributions.find((entry: any) => entry.id === first.id).payload
			.modelRequests
		assert(
			Array.isArray(metrics) && metrics.length > 0,
			'Actual model observations must be saved with the reply'
		)
		assert(
			metrics.every(
				(m: any) =>
					m.status === 'completed' && m.durationMs > 0 && m.inputTokens > 0 && m.outputTokens > 0
			)
		)
		assert.deepEqual(
			(await state()).turns.find((t: any) => t.id === first.id).modelRequests,
			metrics,
			'Reload must preserve the exact observed request metrics'
		)
		await session.execute(
			`document.querySelector('li[data-model-request-id="${metrics[0].id}"]').closest('details').setAttribute('data-model-proof','true')`
		)
		await click('[data-model-proof="true"] > summary')
		await wait(
			`(()=>{const d=document.querySelector('[data-model-proof="true"]');return d.open&&d.innerText.includes('Eingabe:')&&d.innerText.includes('Ausgabe:')&&!d.innerText.includes('nicht gemeldet')})()`,
			3000
		)
		await screenshot('model-usage')
		await click('[data-model-proof="true"] > summary')
		await wait(`!document.querySelector('[data-model-proof="true"]').open`, 3000)
		evidence.checks.push(
			'Real provider usage and phase timings survive SQL persistence/reload and open in the native details control'
		)
		evidence.checks.push(
			'Manual unpress, negative override and inline reason survive a bundled-webview reload'
		)
		await screenshot('feedback')

		await submit(
			'Create a new Intent called Exhibit wording. Carry the name of our display from this conversation there and suggest one short welcome sentence using that name. Do not save any task or file.'
		)
		await wait(
			`window.__avenWorkday.intents().selectedId!==${JSON.stringify(id)}&&window.__avenWorkday.intents().selectedId`
		)
		const newId = await selected()
		evidence.destinationId = newId
		result = await settled(newId)
		const admitted = result.turns.find((t: any) => t.role === 'user')
		assert.equal(admitted.inputAdmission.sourceContext.intentId, id)
		assert(admitted.inputAdmission.sourceContext.messages.length <= 4)
		assert(
			result.turns.some((t: any) => t.role === 'assistant' && /Lantern Garden/i.test(t.content))
		)
		assert(await session.execute('return !!document.querySelector(".source-context")'))
		evidence.checks.push(
			'An explicit new Intent navigates after admission and receives visible bounded source context without a redundant question'
		)
		await screenshot('source-context')
		await session.navigate(options.dashboard)
		await wait('window.__avenWorkday', 45_000)
		await click(`button[data-upload-intent-id="${newId}"]`)
		await submit(
			'Quel était le nom de cette exposition ? Réponds en une seule phrase, sans créer de tâche.'
		)
		await wait(`window.__avenWorkday.state().turns.filter(t=>t.role==='assistant').length>=2`)
		result = await settled(newId)
		assert.match(result.turns.at(-1).content, /Lantern Garden/i)
		evidence.checks.push(
			'A French continuation resolves the prior reference after reload from durable history'
		)
		await submit(
			'Go back to the Intent named Fictional craft shelves and suggest one more brief label for glue. Just answer there.'
		)
		await wait(`window.__avenWorkday.intents().selectedId===${JSON.stringify(id)}`)
		await settled(id)
		evidence.checks.push(
			'Explicit return to a named existing Intent selects that Intent after successful admission'
		)
		const before = (await state()).turns.length
		await submit(
			'Here, calculate six separate imaginary craft orders with the calculator, one at a time: 7 x 19 EUR, 8 x 23 EUR, 9 x 29 EUR, 11 x 31 EUR, 12 x 37 EUR and 14 x 41 EUR. Explain each result briefly. Do not save or change anything.'
		)
		await wait(
			`window.__avenWorkday.state().turns.length>${before}&&window.__avenWorkday.state().turns.some(t=>t.role==='assistant'&&t.pending)`
		)
		const pending = (await state()).turns.findLast((t: any) => t.role === 'assistant' && t.pending)
		assert(pending)
		await screenshot('pending-response')
		await submit('This reply is taking far too long. I am disappointed with the waiting.')
		await wait(
			`window.__avenWorkday.state().turns.some(t=>t.role==='user'&&t.feedbackCheck?.recent?.some(r=>r.responseId===${JSON.stringify(pending.id)}&&r.pending))`
		)
		await settled(id)
		await wait(
			`document.querySelector('[data-response-id="${pending.id}"] [aria-label="Unhelpful response"]')?.getAttribute('aria-pressed')==='true'`
		)
		stored = await readMessage(pending.id)
		assert.equal(stored.feedback.vote, 'down')
		assert(stored.feedback.inferredFrom)
		assert.equal(
			(await readMessage(first.id)).feedback.reason,
			'I would prefer labels suitable for a child to read.'
		)
		evidence.checks.push(
			'A complaint while the actual calculation response is pending waits for that exact reply, not an older answer'
		)
		await screenshot('completed')
		const archived = await evaluate(
			`const detail=await window.__TAURI_INTERNALS__.invoke('intent_get',{intentId:${JSON.stringify(newId)}});return await window.__TAURI_INTERNALS__.invoke('intent_lifecycle',{intentId:detail.id, action:'archive',command:{id:detail.id,expectedVersion:detail.version}})`
		)
		assert.equal(archived.state, 'archive')
		await session.navigate(options.dashboard)
		await wait('window.__avenWorkday', 45_000)
		await click(`button[data-upload-intent-id="${id}"]`)
		await submit(
			'Go back to the archived Intent called Exhibit wording. In that Intent, remind me what our display was called. Do not create a new Intent or a task.'
		)
		await wait(`window.__avenWorkday.intents().selectedId===${JSON.stringify(newId)}`)
		result = await settled(newId)
		assert.match(result.turns.at(-1).content, /Lantern Garden/i)
		assert(
			!result.turns
				.at(-1)
				.calls.some((call: any) => ['intent_restore', 'intent_archive'].includes(call.name)),
			'Opening an archived conversation must not change its archive state'
		)
		assert.equal(
			(
				await evaluate(
					`return await window.__TAURI_INTERNALS__.invoke('intent_get',{intentId:${JSON.stringify(newId)}})`
				)
			).state,
			'archive'
		)
		await wait(
			`document.querySelector('[data-intent-id="${newId}"]')?.getAttribute('aria-current')==='page'`
		)
		assert.equal(
			await session.execute(
				`return document.querySelector('[aria-label="Archiv"]').getAttribute('aria-expanded')`
			),
			'true'
		)
		await click('[aria-label="Archiv"]')
		await wait(
			`document.querySelector('[aria-label="Archiv"]')?.getAttribute('aria-expanded')==='false'`
		)
		assert.equal(
			await session.execute(
				`return document.querySelector('[aria-label="Archiv"]').getAttribute('aria-expanded')`
			),
			'false'
		)
		await click('[aria-label="Archiv"]')
		await screenshot('archived-intent')
		evidence.checks.push(
			'Explicit archived destination is selected and revealed in the rail; its carried context remains readable, and manual folding is respected'
		)

		// Old user messages are outside the hydrated/context tail. Seed only invented
		// history through the real native API; the actual answer still comes from Qwen.
		const historyId = randomUUID()
		const history = Array.from({ length: 34 }, (_, index) => ({
			id: randomUUID(),
			text:
				index === 6
					? 'The imaginary seed cabinet uses an amber crescent on drawer seven.'
					: `Fictional seed inventory observation: note ${index + 1}, reserve bin ${index + 1} for practice packets.`
		}))
		evidence.historyIntentId = historyId
		await evaluate(
			`const invoke=window.__TAURI_INTERNALS__.invoke;
			await invoke('intent_create',{intent:{id:${JSON.stringify(historyId)},title:'Fictional seed inventory',intentType:'conversation',sourceLabel:'Chat'}});
			for (const item of ${JSON.stringify(history)}) {
				await invoke('intent_append_contribution',{intentId:${JSON.stringify(historyId)},contribution:{id:item.id,contributorKind:'human',kind:'message',text:item.text,payload:{}}});
				await invoke('intent_append_contribution',{intentId:${JSON.stringify(historyId)},contribution:{id:crypto.randomUUID(),contributorKind:'agent',kind:'activity',text:'Synthetic inventory observation recorded.',payload:{}}});
			}
			return true;`
		)
		await session.navigate(options.dashboard)
		await wait('window.__avenWorkday', 45_000)
		await click(`button[data-upload-intent-id="${historyId}"]`)
		await wait(`window.__avenWorkday.intents().selectedId===${JSON.stringify(historyId)}`)
		assert(!(await state()).turns.some((turn: any) => turn.id === history[6].id))
		await submit(
			'Hier im aktuellen Intent: Zitiere bitte meine siebte Nachricht in zeitlicher Reihenfolge. Zähle nur meine Chatnachrichten, keine Aktivitätseinträge.'
		)
		await wait('window.__avenWorkday.state().turns.some(t=>t.role==="assistant")')
		// Inspect the live history-bearing request, not whichever answer/repair
		// round finishes last. An answer-only repair legitimately omits old history.
		await wait(
			`(()=>{const rows=window.__avenWorkday.request()?.messages.slice(1)??[];const openings=rows.map(m=>m.role+':'+m.content?.slice(0,32)+':'+(m.tool_call_id??''));return new Set(openings).size<openings.length;})()`
		)
		await click('[aria-label="Chat debug"]')
		await wait(
			`(()=>{const request=window.__avenWorkday.request();const rows=request?.messages.slice(1)??[];const displayed=[...document.querySelectorAll('[data-request-message-index]')].map(row=>row.querySelector(':scope > pre')?.textContent??'');const openings=rows.map(m=>m.role+':'+m.content?.slice(0,32)+':'+(m.tool_call_id??''));return new Set(openings).size<openings.length&&JSON.stringify(displayed)===JSON.stringify(rows.map(m=>m.content));})()`,
			5000
		)
		evidence.contextInspection = await session.execute(
			`return {request:window.__avenWorkday.request(),displayed:[...document.querySelectorAll('[data-request-message-index]')].map(row=>row.querySelector(':scope > pre')?.textContent??'')}`
		)
		const inspectedRows = evidence.contextInspection.request.messages.slice(1)
		const openings = inspectedRows.map(
			(message: any) =>
				`${message.role}:${message.content?.slice(0, 32)}:${message.tool_call_id ?? ''}`
		)
		assert(new Set(openings).size < openings.length)
		assert.deepEqual(
			evidence.contextInspection.displayed,
			inspectedRows.map((message: any) => message.content)
		)
		await screenshot('context-inspection')
		await click('[aria-label="Chat debug"]')
		await wait('!document.querySelector("[data-request-message-index]")', 5000)
		evidence.checks.push(
			'Context inspection renders every prepared message in order, including repeated openings, during the live request and closes normally'
		)
		result = await settled(historyId)
		const answer = result.turns.at(-1)
		assert(answer.content.includes(history[6].text))
		assert(
			answer.calls.some(
				(call: any) =>
					call.status === 'completed' &&
					call.name === 'workspace_search' &&
					JSON.parse(call.arguments).role === 'user' &&
					JSON.parse(call.arguments).order === 'oldest'
			)
		)
		assert(answer.calls.every((call: any) => call.status === 'completed'))
		assert(
			answer.calls.some((call: any) => {
				if (call.name !== 'workspace_read') return false
				const read = JSON.parse(call.result)
				return (
					(read.sourceId === history[6].id && read.content?.includes(history[6].text)) ||
					read.conversation?.some(
						(message: any) =>
							message.sourceId === history[6].id &&
							message.complete &&
							message.content.includes(history[6].text)
					)
				)
			}),
			'An exact quote must come from a source read, not just a search preview'
		)
		await screenshot('old-message-retrieval')
		evidence.checks.push(
			'Qwen retrieves the seventh old user message through the native role/order query, excluding interleaved activity and quoting the exact stored text'
		)

		// Exercise task reassociation through the same native session as chat. The
		// destination is real stored host context; no task or model answer is seeded.
		const taskDestination = randomUUID()
		await evaluate(
			`return await window.__TAURI_INTERNALS__.invoke('intent_create',{intent:{id:${JSON.stringify(taskDestination)},title:'Fictional gallery transport',intentType:'conversation',sourceLabel:'Chat'}})`
		)
		await session.navigate(options.dashboard)
		await wait('window.__avenWorkday', 45_000)
		await click(`button[data-upload-intent-id="${id}"]`)
		const sendTaskTurn = async (text: string) => {
			const previous = (await state()).turns.filter((turn: any) => turn.role === 'assistant').length
			await submit(text)
			await wait(
				`window.__avenWorkday.intents().selectedId!==${JSON.stringify(id)}||window.__avenWorkday.pendingInputs().some(p=>p.stage==='failed'||p.stage==='choice')||window.__avenWorkday.state().turns.filter(t=>t.role==='assistant').length>${previous}`
			)
			assert.equal(await selected(), id, 'An action target must not relocate the conversation')
			return (await settled(id)).turns.at(-1)
		}
		const tasks = async (intentId: string) => {
			const page = await evaluate(
				`const ctx=await window.__TAURI_INTERNALS__.invoke('task_context');return await window.__TAURI_INTERNALS__.invoke('task_request',{scope:ctx.scope,method:'GET',path:${JSON.stringify(`/tasks?intentId=${intentId}&archived=false&limit=100`)},body:null})`
			)
			assert.equal(page.complete, true)
			return page.tasks as any[]
		}
		const created = await sendTaskTurn(
			'Here in Fictional craft shelves, save exactly two personal tasks with these exact titles: "Pack the velvet frame" and "Label the practice brushes". Keep both open, without dates. Do not create other tasks or files. Confirm briefly.'
		)
		assert(created.calls.some((call: any) => call.name === 'todo_create'))
		assert(created.calls.every((call: any) => call.status === 'completed'))
		const originalTasks = await tasks(id)
		assert.equal(originalTasks.length, 2)
		const moved = originalTasks.find((task: any) => task.title === 'Pack the velvet frame')
		const remaining = originalTasks.find((task: any) => task.title === 'Label the practice brushes')
		assert(moved && remaining)
		await session.navigate(options.dashboard)
		await wait('window.__avenWorkday', 45_000)
		await click(`button[data-upload-intent-id="${id}"]`)
		const changed = await sendTaskTurn(
			'Quédate en este chat. Reasigna únicamente la tarea "Pack the velvet frame" al Intent existente "Fictional gallery transport". Conserva la misma tarea, su título, estado y fechas; no crees copias ni cambies la otra tarea. Confirma brevemente.'
		)
		assert(changed.calls.some((call: any) => call.name === 'todo_update'))
		assert(changed.calls.every((call: any) => call.status === 'completed'))
		assert(!changed.calls.some((call: any) => call.name === 'todo_create'))
		const destinationTasks = await tasks(taskDestination)
		assert.equal(destinationTasks.length, 1)
		assert.deepEqual(destinationTasks[0], {
			...moved,
			intentId: taskDestination,
			revision: moved.revision + 1,
			updatedAt: destinationTasks[0].updatedAt
		})
		assert.deepEqual(await tasks(id), [remaining])
		evidence.taskReassociation = {
			origin: id,
			destination: taskDestination,
			originalTasks,
			destinationTasks
		}
		await session.navigate(options.dashboard)
		await wait('window.__avenWorkday', 45_000)
		await click(`button[data-upload-intent-id="${id}"]`)
		const list = await sendTaskTurn(
			'Hier bitte nur die Todos-Ansicht öffnen, damit ich meine Aufgaben sehen kann. Keine Aufgaben verändern.'
		)
		assert(
			list.calls.some(
				(call: any) => call.name === 'list_window_toggle' && call.status === 'completed'
			)
		)
		await wait(
			`document.querySelector('.task-window[aria-busy="false"]')&&!document.querySelector('.task-error')`
		)
		for (const task of originalTasks)
			assert.equal(
				await session.execute(
					`return [...document.querySelectorAll('.task-list .task-title')].filter(e=>e.textContent===${JSON.stringify(task.title)}).length`
				),
				1,
				'Each task must appear exactly once in the workspace list after reload'
			)
		await screenshot('tasks-after-reassociation')
		evidence.checks.push(
			'English task creation, Spanish reassociation after reload and German list opening use the real native gateway; identity, fields, revisions and the untouched task are verified from storage and both rows appear once'
		)
		await liveNativeContextBoundaries(session, evidence)
		evidence.checks.push(
			'Authenticated native transport preserves near-limit conversation facts, reports actual context overflow and accepts a fresh request afterward'
		)
		evidence.passed = true
	} catch (error) {
		evidence.error = String(error)
		await screenshot('failure').catch(() => {})
		evidence.body = await session.bodyText().catch(String)
		evidence.lastState = await state().catch(String)
		evidence.pending = await session
			.execute('return window.__avenWorkday?.pendingInputs()')
			.catch(String)
		evidence.lastRequest = await session
			.execute('return window.__avenWorkday?.request()')
			.catch(String)
		throw error
	} finally {
		evidence.finishedAt = new Date().toISOString()
		await writeFile(options.evidencePath, JSON.stringify(evidence, null, 2))
	}
}
