/** Isolated native transport + actual Qwen + shared engine/Actor/UI. No customer corpus. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { TauriSession } from './tauri-driver'

const [binary, privateSession] = process.argv.slice(2)
const sources = process.env.NATIVE_PROOF === 'sources'
const noteTitles = [
	'Cutter hinge',
	'Dust collector',
	'Drying rack',
	'Press alignment',
	'Paint cabinet',
	'Water filter',
	'Bench clamp',
	'Storage shelf',
	'Window latch',
	'Soldering stand',
	'Polishing wheel',
	'Air hose',
	'Label printer',
	'Binding press',
	'Cutting mat',
	'Glazing tray',
	'Tool trolley',
	'Clay mixer',
	'Measuring jig',
	'Spray booth',
	'Glue dispenser',
	'Stencil frame',
	'Packing table'
].map((subject) => `Maintenance note: ${subject}`)
assert(
	binary && privateSession,
	'Supply an isolated development client binary (port 1457) and a synthetic private-session file.'
)
const session = JSON.parse(await readFile(privateSession, 'utf8'))
assert.equal(session.identity, 'http://localhost:13100')
const output = await mkdtemp('/tmp/aven-live-native-progress-')
const browser = await chromium.launch({ headless: true })
let native: TauriSession | undefined
const evidence: any = {
	synthetic: true,
	passed: false,
	scope:
		'Native IPC, authenticated local model API, shared chat engine/calculation Actor and production progress component; isolated presentation, not a full customer workday',
	startedAt: new Date().toISOString(),
	cases: []
}
console.log(output)
try {
	const context = await browser.newContext({ storageState: session.browser })
	const page = await context.newPage()
	native = await TauriSession.launch(binary)
	await native.waitForBodyText('GERÄTECODE', 45_000)
	const code = (await native.bodyText()).match(/\b([A-Z0-9]{4})-([A-Z0-9]{4})\b/)
	assert(code)
	await page.goto(`${session.identity}/device?user_code=${code[1]}${code[2]}`)
	await page.getByRole('button', { name: 'Authorize', exact: true }).click()
	await page.getByRole('heading', { name: 'Device connected', exact: true }).waitFor()
	for (let i = 0; ; i++) {
		assert(i < 100, 'Native sign-in deadline')
		await native.execute(
			`window.__signedIn=null; window.__TAURI_INTERNALS__.invoke('auth_status').then(s=>window.__signedIn=s.authenticated);`
		)
		await Bun.sleep(250)
		if (await native.execute('return window.__signedIn')) break
	}
	await native.execute(`window.__progressReady=null; (async()=>{
		const {mount}=await import('/@id/svelte');
		const {Chat}=await import('/src/lib/chat/chat.svelte.ts');
		const {createCalculationActor}=await import('/@fs/${process.cwd()}/libs/aven-actors/src/calculation.ts');
		const {default:View}=await import('/src/lib/chat/ToolCalls.svelte');
		const actor=createCalculationActor();
		let actors=[actor];
		if (${sources}) {
			const {SourceCatalog}=await import('/src/lib/intents/source-catalog.ts');
			const {readSource,searchSources}=await import('/src/lib/intents/source-retrieval.ts');
			const {createRetrievalActor}=await import('/@fs/${process.cwd()}/libs/aven-actors/src/retrieval.ts');
			const manual='Kapitel A: Schutzbrille tragen. '+'. '.repeat(6100)+'Kapitel B: Lüftung einschalten. '+'. '.repeat(6100)+'Kapitel C: Hauptschalter ausschalten.';
			const catalog=new SourceCatalog(async e=>({content:e.artifactId==='synthetic-handbook'?manual:'Fictional maintenance record '+e.title,complete:true}));
			catalog.inventoryComplete=true;
			for(const [n,title] of ${JSON.stringify(noteTitles)}.entries()) catalog.register({artifactId:'synthetic-note-'+String(n+1).padStart(2,'0'),intentId:'synthetic-workshop',title,kind:'text'});
			catalog.register({artifactId:'synthetic-handbook',intentId:'synthetic-workshop',title:'Fictional safety handbook',kind:'text'});
			while(catalog.coverage().pending) await new Promise(r=>setTimeout(r,10));
			const outcome=value=>({record:JSON.stringify(value),wire:JSON.stringify(value)});
			actors.push(createRetrievalActor({artifact_search:async args=>outcome(await searchSources(catalog,args)),artifact_detail:async args=>outcome(await readSource(catalog,args))}));
			window.__sourceCatalog=catalog;
		}
		const chat=new Chat({}, {specs:actors.flatMap(a=>a.manifest.methods.map(({name,description,parameters})=>({name,description,parameters}))),
			run:(name,args)=>actors.find(a=>a.manifest.methods.some(m=>m.name===name)).deliver(name,JSON.parse(args))});
		window.__progressChat=chat;
		const host=document.createElement('section');
		host.style.cssText='position:fixed;inset:30px;z-index:99999;overflow:auto;background:#faf8ef;padding:24px;color:#223047';
		host.setAttribute('aria-label','Synthetic live progress proof');document.body.append(host);
		mount(View,{target:host,props:{get calls(){return chat.toolCalls},get active(){return chat.streaming},
			get startedAt(){return chat.responseStartedAt},get modelActivity(){return chat.modelActivity},get recovering(){return chat.recoveringStream}}});
		window.__progressReady=true;
	})().catch(e=>window.__progressReady=String(e));`)
	for (let i = 0; ; i++) {
		assert(i < 120, 'Component setup deadline')
		const ready = await native.execute('return window.__progressReady')
		if (ready) {
			assert.equal(ready, true)
			break
		}
		await Bun.sleep(250)
	}
	const cases = sources
		? [
				[
					'inventory',
					'Find all documents whose title contains Maintenance note. List every matching document title, not their contents. Search all result pages; I need the full list, not a sample.',
					'23'
				],
				[
					'handbook',
					'Lies jetzt das gesamte Dokument synthetic-handbook und nenne alle drei Sicherheitsanweisungen aus Kapitel A, B und C. Bitte vollständig lesen, ohne nochmal nachzufragen.',
					'Hauptschalter'
				]
			]
		: [
				[
					'materials',
					'Rechne für unseren erfundenen Bastelkurs: 8 Kartons kosten jeweils 13,25 EUR. Wie viel kosten alle Kartons?',
					'106'
				],
				[
					'share',
					'Now divide a fictional 63.60 EUR workshop expense equally among 3 people. Give the share per person.',
					'21.2'
				]
			]
	for (const [name, text, expected] of cases) {
		const run: any = { name, text, observed: [], passed: false }
		evidence.cases.push(run)
		await native.execute(
			`window.__progressDone=false;window.__progressChat.send(arguments[0]).finally(()=>window.__progressDone=true)`,
			[text]
		)
		let savedReview = false
		for (let i = 0; ; i++) {
			assert(i < 2400, 'Live chat deadline')
			const state = JSON.parse(
				await native.execute<string>(`return JSON.stringify({done:window.__progressDone,
				model:window.__progressChat.modelActivity,
				phase:document.querySelector('[aria-label="Current agent step"]')?.getAttribute('data-phase'),
				label:document.querySelector('[aria-label="Current agent step"]')?.textContent,
				timer:document.querySelector('.tool-calls > summary .timing')?.textContent,
				failure:window.__progressChat.failure})`)
			)
			if (state.done) break
			if (state.model) {
				assert.equal(
					state.phase,
					state.model.phase,
					'Visible status must follow the currently executing model phase'
				)
				assert(state.timer && !/^0(?:\.0)? ?s$/.test(state.timer))
				if (!run.observed.some((v: any) => v.id === state.model.id && v.timer === state.timer))
					run.observed.push({ ...state.model, visible: state.label, timer: state.timer })
				if (state.model.phase === 'verification' && !savedReview) {
					await writeFile(
						`${output}/${name}-verification.png`,
						Buffer.from(await native.screenshot(), 'base64')
					)
					savedReview = true
				}
			}
			await Bun.sleep(250)
		}
		run.result = JSON.parse(
			await native.execute<string>('return JSON.stringify(window.__progressChat.export())')
		)
		assert.equal(run.result.failure, null)
		assert(run.observed.some((v: any) => v.phase === 'answer'))
		assert(run.observed.some((v: any) => v.phase === 'verification'))
		assert(
			run.observed.some((a: any) =>
				run.observed.some((b: any) => a.id === b.id && a.timer !== b.timer)
			),
			'Elapsed time must visibly advance'
		)
		const turn = run.result.turns.at(-1)
		if (sources) {
			assert(turn.content.includes(expected!))
			assert(!turn.calls.some((c: any) => c.status === 'failed'), 'No failed lookup attempts')
			if (name === 'inventory') {
				for (const title of noteTitles)
					assert(turn.content.includes(title), 'Every title must be delivered')
				assert(
					turn.calls.some(
						(c: any) => c.name === 'workspace_search' && JSON.parse(c.arguments).cursor
					),
					'Must follow result cursor'
				)
			} else {
				const offsets = turn.calls
					.filter(
						(c: any) =>
							c.name === 'workspace_read' && JSON.parse(c.arguments).id === 'synthetic-handbook'
					)
					.map((c: any) => JSON.parse(c.arguments).offset ?? 0)
				for (const offset of [0, 12000, 24000])
					assert(offsets.includes(offset), 'Every handbook page must be read')
				for (const word of ['Schutzbrille', 'Lüftung', 'Hauptschalter'])
					assert(turn.content.includes(word))
				assert(
					!/erneut.*hochladen|unvollständig|truncated|re.?upload/i.test(turn.content),
					'Pagination is not an incomplete upload'
				)
			}
		} else
			assert(
				turn.calls.some(
					(c: any) =>
						c.name === 'calculate' && c.status === 'completed' && c.result.includes(expected!)
				)
			)
		assert.equal(await native.execute('return window.__progressChat.modelActivity'), null)
		assert.equal(
			await native.execute(
				`return Boolean(document.querySelector('[aria-label="Current agent step"]'))`
			),
			false
		)
		run.passed = true
	}
	evidence.passed = true
	if (sources)
		evidence.scope =
			'Native IPC and live Qwen; real shared retrieval Actor, IndexedDB index, source paging and chat review over independently invented text. No customer files, ingest or database persistence.'
} finally {
	await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2))
	await native?.close()
	await browser.close()
}
console.log('PASS real-model native progress', output)
