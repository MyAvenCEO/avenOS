import { expect } from '@playwright/test'
import { studioStories } from './studio-agent-fixture'
import type { TauriSession } from './tauri-driver'

const unrelatedHistoryCount = 24
export const studioHistoryIntentCount = studioStories.length + unrelatedHistoryCount

/** Real signed-in desktop, customer Intents, agent tool loop, Runner and Artifact Store.
 * Only model decisions and the accepted speech transcript are fixture-controlled.
 */
export async function studioAgentJourney(
	session: TauriSession,
	intentBase: string,
	headers: Record<string, string>
) {
	async function post(path: string, body: unknown) {
		const response = await fetch(path, {
			method: 'POST',
			headers: { ...headers, 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
		if (!response.ok)
			throw Error(`Studio history seed failed: ${response.status} ${await response.text()}`)
		return response.json()
	}
	async function native(command: string, args: Record<string, unknown>): Promise<any> {
		await session.execute(
			`window.__studioProof = null;
			window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1])
			.then(value => window.__studioProof = {value}).catch(error => window.__studioProof = {error: String(error)});`,
			[command, args]
		)
		for (let attempt = 0; attempt < 300; attempt++) {
			const result = await session.execute<any>('return window.__studioProof')
			if (result?.error) throw Error(result.error)
			if (result) return result.value
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
		throw Error(`Native ${command} timed out`)
	}
	async function studio(operation: string, data: Record<string, unknown> = {}): Promise<any> {
		return native('studio_request', { command: { operation, data } })
	}
	async function button(label: string, root = 'body', selector = 'button') {
		try {
			await expect
				.poll(
					() =>
						session.execute(
							`
			document.querySelectorAll('[data-studio-click]').forEach(e => e.removeAttribute('data-studio-click'));
			const button = [...document.querySelector(arguments[1]).querySelectorAll(arguments[2])].find(e => e.textContent.trim().includes(arguments[0]) && e.getClientRects().length && !e.disabled);
			if (!button) return false;
			button.scrollIntoView({block: 'center', inline: 'nearest'});
			const box = button.getBoundingClientRect();
			const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
			if (!box.width || !box.height || !hit || !button.contains(hit)) return false;
			button.setAttribute('data-studio-click', 'true'); return true;`,
							[label, root, selector]
						),
					{ timeout: 20000 }
				)
				.toBe(true)
			await click('[data-studio-click="true"]')
		} catch (cause) {
			const controls = await session.execute(
				`return [...document.querySelectorAll(arguments[0] + ' ' + arguments[1])].filter(e => e.textContent.includes(arguments[2])).map(e => { const r = e.getBoundingClientRect(); return {text: e.textContent, disabled: e.disabled, bounds: {x:r.x,y:r.y,width:r.width,height:r.height}, hit: document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0, 400)} })`,
				[root, selector, label]
			)
			throw Error(
				`Could not click ${label}: ${String(cause)}\n${JSON.stringify(controls)}\n${await session.bodyText()}`
			)
		}
	}
	async function click(selector: string) {
		try {
			await expect
				.poll(
					() =>
						session.execute(
							`const e = document.querySelector(arguments[0]); return !!e && !e.disabled && e.getClientRects().length > 0`,
							[selector]
						),
					{ timeout: 15000 }
				)
				.toBe(true)
			// Native WebKit can acknowledge a layout scroll before painting it.
			// Wait for rendered frames before sending physical pointer input.
			await session.execute(
				`
				const element = document.querySelector(arguments[0]);
				element.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'});
				window.__studioPainted = false;
				window.__studioClickObserved = false;
				window.__studioClickTarget = null;
				requestAnimationFrame(() => requestAnimationFrame(() => window.__studioPainted = true));
				document.addEventListener('click', event => {
					window.__studioClickObserved = event.composedPath().includes(element);
					window.__studioClickTarget = event.target.outerHTML?.slice(0,400);
				}, {capture:true, once:true});`,
				[selector]
			)
			await expect
				.poll(
					() =>
						session.execute(
							`
			const element = document.querySelector(arguments[0]);
			if (!element || element.disabled || !window.__studioPainted) return false;
			const box = element.getBoundingClientRect();
			const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
			return box.width > 0 && box.height > 0 && hit && element.contains(hit);`,
							[selector]
						),
					{ timeout: 15000 }
				)
				.toBe(true)
			await session.click(await session.find(selector))
			await expect
				.poll(() => session.execute('return window.__studioClickObserved'), { timeout: 3000 })
				.toBe(true)
		} catch (cause) {
			const control = await session.execute(
				`const e = document.querySelector(arguments[0]); if (!e) return {missing:true, lastClick:window.__studioClickTarget}; const r = e.getBoundingClientRect(); return {disabled:e.disabled, lastClick:window.__studioClickTarget, bounds:{x:r.x,y:r.y,width:r.width,height:r.height}, viewport:{width:innerWidth,height:innerHeight}, hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,400)}`,
				[selector]
			)
			throw Error(
				`Could not click ${selector}: ${String(cause)}\n${JSON.stringify(control)}\n${await session.bodyText()}`
			)
		}
	}
	async function closeChat() {
		const shown = await session.execute(
			'return !!document.querySelector(\'[aria-label="Close conversation"]\')'
		)
		if (shown) await click('[aria-label="Close conversation"]')
	}
	async function say(text: string, mode = 'written') {
		if (mode === 'transcript') {
			await session.execute(
				"window.dispatchEvent(new CustomEvent('aven-e2e-accepted-transcript', {detail: {text: arguments[0]}}))",
				[text]
			)
		} else {
			const shown = await session.execute(
				'return !!document.querySelector(\'[aria-label="Message Aven"]\')'
			)
			if (!shown) await click('[aria-label="Start conversation"], [aria-label="Open conversation"]')
			await session.type(await session.findEventually('[aria-label="Message Aven"]'), text)
			await click('[aria-label="Send message"], [aria-label="Senden"]')
		}
		// The wiring fixture has no semantic router. Use the visible manual route
		// recovery; live-Qwen journeys separately require automatic decisions.
		await session.findEventually('[data-stage="failed"] [data-route-action="choose"]')
		if (await session.execute(`return !!document.querySelector('[data-route-action="keep"]')`)) {
			await click('[data-route-action="keep"]')
		} else {
			await click('[data-route-action="choose"]')
			await session.type(
				await session.find('[aria-label="New Intent title"]'),
				'Studio verification'
			)
			await click('[data-route-action="new"]')
		}
	}
	const history = new Map<string, { intentId: string; messageId: string }>()
	for (const story of studioStories) {
		const intentId = crypto.randomUUID(),
			messageId = crypto.randomUUID()
		await post(intentBase, { id: intentId, title: story.key })
		await post(`${intentBase}/${intentId}`, {
			id: messageId,
			contributorKind: 'human',
			kind: 'message',
			text: story.history,
			payload: {}
		})
		history.set(story.key, { intentId, messageId })
	}
	// Push the original procedures out of the recent window. Retrieval must search stored history.
	for (let i = 0; i < unrelatedHistoryCount; i++)
		await post(intentBase, { id: crypto.randomUUID(), title: `Unrelated routine ${i + 1}` })
	const sample = await studio('sample', {
		requestId: crypto.randomUUID(),
		observedAt: new Date().toISOString()
	})
	const email = sample.artifacts.find((a: any) => a.typeKey === 'studio.email')
	await closeChat()
	await click('[aria-label="Skills"]')
	await button('Real cases', '.studio')
	for (const story of studioStories) {
		console.log(`[native Studio] ${story.mode}: ${story.key}`)
		const before = await studio('state')
		await say(story.question, story.mode)
		await session.waitForBodyText(`I found the recorded ${story.key} procedure.`, 45000)
		await closeChat()
		// Proposals open automatically unless an existing human edit needs preserving.
		// Exercise the visible fallback only when that review button is still present.
		if (
			await session.execute(
				`return [...document.querySelectorAll('.case-studio button')].some(e => e.textContent.includes('Review selected case'))`
			)
		)
			await button('Review selected case')
		await expect
			.poll(
				() => session.execute('return document.querySelector(\'[aria-label="Case name"]\')?.value'),
				{ timeout: 15000 }
			)
			.toBe(story.title)
		const state = await studio('state')
		const proposed = state.artifacts.find(
			(a: any) => a.typeKey === 'studio.case' && a.payload.case.title === story.title
		)
		expect(proposed.payload.status).toBe('proposed')
		expect(proposed.payload.case.evidence).toContainEqual(
			expect.objectContaining({
				kind: 'message',
				sourceId: history.get(story.key)!.messageId,
				quote: story.history
			})
		)
		expect(state.skills.length).toBe(before.skills.length)
		expect(state.runs.length).toBe(before.runs.length)
		await button('Yes, this is the case', '.case-studio')
		await session.waitForBodyText('Confirmed case')
		const confirmed = (await studio('state')).artifacts.find(
			(a: any) =>
				a.typeKey === 'studio.case' &&
				a.payload.case.title === story.title &&
				a.payload.status === 'confirmed'
		)
		expect(confirmed.payload.predecessorArtifactId).toBe(proposed.artifactId)
		if (!story.capability) {
			await button('What if', '.case-studio')
			await session.waitForBodyText('nothing executed')
			expect(
				await session.execute(
					"return [...document.querySelectorAll('.case-studio button')].find(e => e.textContent.includes('Build Skill')).disabled"
				)
			).toBe(true)
			expect((await studio('state')).runs.length).toBe(before.runs.length)
			console.log(`[native Studio] confirmed missing capability remains hypothetical: ${story.key}`)
			continue
		}
		await say(story.build)
		const name = story.key.startsWith('Nordton')
			? 'Nordton reusable review'
			: 'Atlas reusable brief'
		await session.waitForBodyText(`Published ${name}. Nothing has run yet.`, 45000)
		await closeChat()
		const published = (await studio('state')).skills.find((a: any) => a.payload.name === name)
		expect(published.payload.caseArtifactId).toBe(confirmed.artifactId)
		expect((await studio('inspect', { artifactId: published.artifactId })).inputs).toContainEqual(
			expect.objectContaining({ role: 'case', artifactId: confirmed.artifactId })
		)
		await click('.studio [aria-label="Refresh"]')
		await button(name, '.studio aside', 'button.draft')
		await expect
			.poll(() =>
				session.execute('return document.querySelector(\'[aria-label="Skill name"]\')?.value')
			)
			.toBe(name)
		if (story.mode === 'transcript') {
			await click('[aria-label="Input email"]')
			await button(email.payload.subject, '[aria-label="Choose email"]')
		}
		await button('Run Skill', '.studio')
		await expect
			.poll(
				async () => {
					const current = await studio('state')
					const runs = current.runs.filter(
						(r: any) => !before.runs.some((old: any) => old.runId === r.runId)
					)
					if (runs.some((r: any) => r.state === 'failed')) throw Error(JSON.stringify(runs))
					return runs.filter((r: any) => r.state === 'succeeded').length
				},
				{ timeout: 45000 }
			)
			.toBe(1)
		const after = await studio('state')
		const run = after.runs.find((r: any) => !before.runs.some((old: any) => old.runId === r.runId))
		const result = run.checkpoints.at(-1).output.artifact
		expect(result.typeKey).toBe(story.mode === 'transcript' ? 'studio.brief' : 'core.file')
		expect((await studio('inspect', { artifactId: result.artifactId })).inputs).toContainEqual(
			expect.objectContaining({ role: 'program', artifactId: published.artifactId })
		)
		await button('Real cases', '.studio')
		console.log(
			`[native Studio] recalled, confirmed, refined, published and executed: ${story.key}`
		)
	}
	// The user commands and agent responses must be durable Intent contributions as well as bubbles.
	// Use the signed-in host's refresh path, not the short-lived token captured before this journey.
	for (const story of studioStories) {
		const result = await native('intent_search', {
			messages: true,
			input: { query: story.question.split(' ').slice(0, 8).join(' '), limit: 20 }
		})
		expect(
			result.messages.some(
				(m: any) => story.question.startsWith(m.content) || m.content === story.question
			)
		).toBe(true)
	}
}
