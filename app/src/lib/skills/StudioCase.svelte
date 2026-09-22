<script lang="ts">
import { parseStudioCase, type StudioCase, type StudioCaseRecord } from '@avenos/actors/studio/case'
import { untrack } from 'svelte'
import { findPastCases, type RecalledCase, readPastCase } from './case-recall'
import StudioOperations from './StudioOperations.svelte'
import {
	refreshStudio,
	type StudioArtifact,
	type StudioDraft,
	studio,
	studioRequest
} from './studio.svelte'
import { studioCaseContext, studioCaseRequest, studioCaseSeed } from './studio-case-context'
import { sameStudioJson } from './studio-equality'

let { onbuild }: { onbuild: (draft: StudioDraft) => void } = $props()
const empty = (): StudioCase => ({
	title: '',
	situation: '',
	outcome: '',
	evidence: [],
	steps: [],
	uncertainties: []
})
let value = $state<StudioCase>(empty())
let saved = $state<StudioArtifact | null>(null)
let busy = $state(false)
let error = $state('')
let notice = $state('')
let query = $state('')
let results = $state<RecalledCase[]>([])
let searched = $state(false)
let cursor = $state<string | null>(null)
let more = $state(false)
let showOperations = $state(false)
let replacing = $state<string | null>(null)
let scenario = $state<{
	steps: Array<{ id: string; label: string; status: string }>
	gaps: number
} | null>(null)
const dirty = $derived(
	!sameStudioJson(value, (saved?.payload as unknown as StudioCaseRecord)?.case)
)
const confirmed = $derived(!dirty && saved?.payload.status === 'confirmed')
const cases = $derived(
	(studio.snapshot?.artifacts ?? []).filter((a) => a.typeKey === 'studio.case')
)
const heads = $derived(
	cases.filter((a) => !cases.some((b) => b.payload.predecessorArtifactId === a.artifactId))
)
const gaps = $derived(value.steps.filter((s) => s.kind === 'ideal').length)

// A proposal from the agent should show the actual case, not an empty form.
// Never replace unsaved human edits or an item selected during the read.
$effect(() => {
	const requested = $studioCaseRequest
	if (!requested) return
	untrack(() => {
		if (busy || (dirty && !sameStudioJson(value, empty()))) return
		const before = JSON.stringify($state.snapshot(value))
		void act(async () => {
			const result = await studioRequest<{ artifact: StudioArtifact }>('inspect', {
				artifactId: requested
			})
			if ($studioCaseRequest === requested && JSON.stringify($state.snapshot(value)) === before)
				load(result.artifact)
		})
	})
})

async function act(work: () => Promise<void>) {
	if (busy) return
	busy = true
	error = ''
	notice = ''
	try {
		await work()
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
	} finally {
		busy = false
	}
}
function load(artifact: StudioArtifact) {
	if (dirty && value.title && !window.confirm('Discard unsaved case edits and open this case?'))
		return
	value = parseStudioCase(artifact.payload.case)
	saved = artifact
	scenario = null
	studioCaseRequest.set('')
}
async function search(append = false) {
	const page = await findPastCases(query, append ? cursor : null)
	results = append ? [...results, ...page.items] : page.items
	more = page.hasMore
	cursor = page.nextCursor
	searched = true
}
function newCase() {
	if (dirty && value.title && !window.confirm('Discard unsaved case edits and start another case?'))
		return
	value = empty()
	saved = null
	scenario = null
	results = []
	searched = false
	error = ''
	notice = ''
	studioCaseRequest.set('')
}
async function collect(item: RecalledCase) {
	const detail = await readPastCase(item.id)
	const quote = JSON.stringify({
		conversation: detail.conversation,
		activity: detail.activity
	}).slice(0, 4000)
	if (!value.title) value.title = detail.title
	value.evidence.push({
		id: crypto.randomUUID(),
		kind: 'intent',
		sourceId: detail.id,
		locator: 'recent-history-snapshot',
		quote,
		interpretation: ''
	})
	notice =
		'Evidence added. Open its details, then describe the starting situation and outcome—or ask Aven.'
}
async function save() {
	if (!dirty && saved) return saved
	const exact = parseStudioCase($state.snapshot(value))
	const artifact = await studioRequest<StudioArtifact>('case-propose', {
		case: exact,
		...(saved ? { predecessorArtifactId: saved.artifactId } : {})
	})
	saved = artifact
	value = parseStudioCase(artifact.payload.case)
	scenario = null
	await refreshStudio()
	notice = 'Case saved. Confirm this revision when it matches the work you meant.'
	return artifact
}
async function confirm() {
	const artifact = await save()
	saved = await studioRequest<StudioArtifact>('case-confirm', { artifactId: artifact.artifactId })
	await refreshStudio()
	notice = 'Case confirmed. This confirms your interpretation, not an automated fact check.'
}
function addIdeal() {
	value.steps.push({
		id: crypto.randomUUID(),
		kind: 'ideal',
		label: 'Missing step',
		evidenceIds: [],
		needs: value.situation,
		produces: value.outcome,
		acceptance: ''
	})
}
function move(index: number, direction: number) {
	const next = index + direction
	if (next < 0 || next >= value.steps.length) return
	const steps = [...value.steps]
	;[steps[index], steps[next]] = [steps[next], steps[index]]
	value.steps = steps
}
$effect(() => {
	const seed = $studioCaseSeed
	if (!seed) return
	studioCaseSeed.set(null)
	if (!value.evidence.some((e) => e.kind === 'artifact' && e.sourceId === seed.artifactId)) {
		value.evidence.push({
			id: crypto.randomUUID(),
			kind: 'artifact',
			sourceId: seed.artifactId,
			locator: 'artifact-payload-snapshot',
			quote: JSON.stringify(seed.payload).slice(0, 4000),
			interpretation: ''
		})
		if (!value.title) value.title = seed.title
	}
})
$effect(() => {
	studioCaseContext.artifactId = saved?.artifactId ?? ''
	studioCaseContext.summary = JSON.stringify({
		status: dirty ? 'unsaved' : (saved?.payload.status ?? 'unsaved'),
		predecessorArtifactId: saved?.payload.predecessorArtifactId ?? null,
		title: value.title,
		situation: value.situation,
		outcome: value.outcome,
		evidence: value.evidence.slice(0, 8).map((e) => ({ ...e, quote: e.quote.slice(0, 1000) })),
		steps: value.steps,
		unsaved: dirty
	}).slice(0, 8000)
})
</script>

<section class="case-studio" aria-label="Real case">
	<div class="case-heading">
		<button onclick={newCase}>＋ New case</button>
		<div>
			<small>FROM EXPERIENCE TO SKILL</small>
			<h2>What did you do before?</h2>
			<p>Find the work. Confirm the case. Make it repeatable.</p>
		</div>
		<span class="status"
			>{confirmed ? '✓ Confirmed case' : dirty && saved ? 'Unsaved revision' : 'Case proposal'}</span
		>
	</div>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	{#if notice}
		<p class="notice" role="status">{notice}</p>
	{/if}
	{#if $studioCaseRequest}
		<button
			class="primary"
			onclick={() => void act(async () => { const result = await studioRequest<{ artifact: StudioArtifact }>('inspect', { artifactId: $studioCaseRequest }); load(result.artifact) })}
		>
			Review selected case →
		</button>
	{/if}
	{#if heads.length}
		<div class="case-shelf" aria-label="Saved cases">
			{#each heads as item}
				<button class:chosen={saved?.artifactId === item.artifactId} onclick={() => load(item)}>
					{String((item.payload.case as StudioCase).title)}
					<small>{item.payload.status === 'confirmed' ? '✓' : '◇'}</small>
				</button>
			{/each}
		</div>
	{/if}
	<div class="case-columns">
		<details class="card" open={!confirmed}>
			<summary>
				<strong>Supporting evidence</strong
				><small
					>{value.evidence.length} {value.evidence.length === 1 ? 'source' : 'sources'} · expand to
					inspect or add</small
				>
			</summary>
			<h3>Find the real work</h3>
			<form onsubmit={e => { e.preventDefault(); void act(() => search()) }}>
				<input
					aria-label="Search past work"
					placeholder="A person, project, or something you remember…"
					bind:value={query}
				><button disabled={busy}>Search</button>
			</form>
			<small
				>Search task names and details. Ask Aven to look through messages and documents. No match
				does not prove absence.</small
			>
			{#each results as item}
				<button class="result" disabled={busy} onclick={() => void act(() => collect(item))}>
					<span
						><b>{item.title}</b
						><small>{item.source} · {item.status} · {item.id.slice(0,8)}</small></span
					><span>＋ Evidence</span>
				</button>
			{/each}
			{#if searched && !results.length}
				<p>No match yet. Try another phrase, describe it below, or ask Aven to look further.</p>
			{/if}
			{#if more}
				<button disabled={busy} onclick={() => void act(() => search(true))}>More past work</button>
			{/if}
			<button
				class="quiet"
				onclick={() => value.evidence.push({ id: crypto.randomUUID(), kind: 'recollection', sourceId: 'user', locator: '', quote: '', interpretation: '' })}
			>
				＋ Describe what I remember
			</button>
			<h3>Supporting evidence <small>{value.evidence.length}</small></h3>
			{#each value.evidence as evidence (evidence.id)}
				<details class="evidence" open={evidence.kind === 'recollection'}>
					<summary>
						{evidence.kind === 'recollection' ? 'Your recollection' : `${evidence.kind} · ${evidence.sourceId.slice(0, 12)}`}<small
							>Attributed · not fact-checked</small
						>
					</summary>
					<label
						>{evidence.kind === 'recollection' ? 'What happened?' : 'Captured source excerpt'}
						<textarea
							aria-label="Evidence text"
							bind:value={evidence.quote}
							readonly={evidence.kind !== 'recollection'}
							rows="4"
						></textarea></label
					><label>What this tells us<input bind:value={evidence.interpretation}></label
					><small>{evidence.locator}</small
					><button
						class="quiet"
						onclick={() => { value.evidence = value.evidence.filter(e => e.id !== evidence.id); for (const step of value.steps) { step.evidenceIds = step.evidenceIds.filter(id => id !== evidence.id) } }}
					>
						Remove evidence
					</button>
				</details>
			{/each}
		</details>
		<details class="card" open={!confirmed}>
			<summary>
				<strong>{confirmed ? value.title : 'Is this the case you meant?'}</strong>
				{#if confirmed}
					<small>{value.outcome}</small>
				{/if}
			</summary>
			<label
				>Case name<input
					aria-label="Case name"
					bind:value={value.title}
					placeholder="Preparing the weekly project brief"
				></label
			><label
				>Started with<textarea
					aria-label="Case situation"
					bind:value={value.situation}
					placeholder="What arrived, and why did it need attention?"
					rows="2"
				></textarea></label
			><label
				>Wanted to achieve<textarea
					aria-label="Case outcome"
					bind:value={value.outcome}
					placeholder="What would a good result look like?"
					rows="2"
				></textarea></label
			>
			{#each value.uncertainties as _, index}
				<label>Still uncertain<input bind:value={value.uncertainties[index]}></label>
			{/each}
			<button class="quiet" onclick={() => value.uncertainties.push('')}>
				＋ Note an uncertainty
			</button>
			<div class="actions">
				<button disabled={busy} onclick={() => void act(async () => { await save() })}>
					Save case
				</button><button
					class="primary"
					disabled={busy || confirmed}
					onclick={() => void act(confirm)}
				>
					Yes, this is the case
				</button>
			</div>
			<small
				>Confirmation keeps the evidence and your interpretation together. Editing creates a new,
				unconfirmed revision.</small
			>
		</details>
	</div>
	<section class="card">
		<div class="section-title">
			<h3>The repeatable procedure</h3>
			<span>{gaps ? `${gaps} missing ${gaps === 1 ? 'piece' : 'pieces'}` : 'Proposed steps'}</span>
		</div>
		{#if !value.steps.length}
			<p>
				Add an existing action, describe a missing step, or ask Aven to sketch the procedure from
				the evidence.
			</p>
		{/if}
		<ol>
			{#each value.steps as step, index (step.id)}
				<li class:ideal={step.kind === 'ideal'}>
					<div class="step-title">
						<span>{String(index + 1).padStart(2, '0')}</span>
						<input aria-label="Step label" bind:value={step.label}>
						<small
							>{step.kind === 'ideal' ? '◇ Needs implementation' : step.kind === 'skill' ? '⌘ Reusable Skill' : '◆ Selected action'}</small
						><button
							aria-label="Move step up"
							disabled={index === 0}
							onclick={() => move(index,-1)}
						>
							↑
						</button><button
							aria-label="Move step down"
							disabled={index === value.steps.length-1}
							onclick={() => move(index,1)}
						>
							↓
						</button><button
							aria-label="Remove step"
							onclick={() => value.steps = value.steps.filter(s => s.id !== step.id)}
						>
							×
						</button>
					</div>
					{#if step.kind === 'ideal'}
						<button onclick={() => { replacing = step.id; showOperations = true }}>
							Replace with an existing action →
						</button>
						<div class="ideal-fields">
							<label>Needs<input aria-label="Ideal step needs" bind:value={step.needs}></label
							><label
								>Would produce<input
									aria-label="Ideal step produces"
									bind:value={step.produces}
								></label
							><label
								>How we’ll know it works<input
									aria-label="Ideal step acceptance"
									bind:value={step.acceptance}
								></label
							>
						</div>
					{/if}
				</li>
			{/each}
		</ol>
		<div class="actions">
			<button onclick={() => { replacing = null; showOperations = true }}>＋ Existing action</button
			><button onclick={addIdeal}>◇ Missing step</button
			><button
				disabled={busy || !value.steps.length}
				onclick={() => void act(async () => { const artifact = await save(); scenario = await studioRequest('case-what-if', { artifactId: artifact.artifactId }) })}
			>
				What if…
			</button><button
				class="primary"
				disabled={busy || !confirmed || !!gaps || !value.steps.length}
				onclick={() => void act(async () => { const draft = await studioRequest<StudioDraft>('case-build', { artifactId: saved!.artifactId }); await refreshStudio(); onbuild(draft) })}
			>
				Build Skill →
			</button>
		</div>
		<small
			>{gaps ? 'Explore What if now. Replace missing steps with existing actions before building an executable Skill.' : !confirmed ? 'Confirm this case revision to build a Skill. Building does not run it.' : 'Build opens an editable draft; publication and execution remain separate choices.'}</small
		>
		{#if scenario && !dirty}
			<div class="scenario">
				<b>What if · nothing executed</b>
				<p>Hypothetical procedure, not tested output.</p>
				{#each scenario.steps as step}
					<div>
						{step.label}
						<span
							>{step.status === 'needs-implementation' ? 'Needs implementation' : step.status === 'depends-on-ideal' ? 'Depends on a missing piece' : 'Not executed'}</span
						>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</section>
<StudioOperations
	bind:open={showOperations}
	contextKey={`${studio.snapshot?.scopeId}/${studio.snapshot?.subjectId}`}
	onchoose={entry => { const index = value.steps.findIndex(s => s.id === replacing); const step = { id: index < 0 ? crypto.randomUUID() : value.steps[index].id, kind: 'action' as const, label: entry.label, capabilityId: entry.capabilityId, evidenceIds: index < 0 ? [] : value.steps[index].evidenceIds }; if (index < 0) value.steps.push(step); else value.steps[index] = step; replacing = null; showOperations = false }}
/>

<style>
.case-studio {
	color: #233043;
	max-width: 1400px;
	margin: 0 auto;
	display: grid;
	gap: 20px;
}
.case-heading,
.section-title,
.step-title,
.actions,
.result,
form {
	display: flex;
	gap: 12px;
	align-items: center;
}
.case-heading,
.section-title {
	justify-content: space-between;
}
.case-heading > div {
	flex: 1;
	order: 0;
}
.case-heading > .status {
	order: 1;
}
.case-heading > button {
	order: 2;
}
h2 {
	font:
		38px Georgia,
		serif;
	margin: 10px 0;
}
h3 {
	font-size: 15px;
	margin: 0 0 16px;
}
p {
	color: #687d79;
	font-size: 14px;
}
small {
	display: block;
	color: #738580;
	font-size: 12px;
	line-height: 1.5;
}
.status {
	background: #e4eae1;
	padding: 8px 14px;
	border-radius: 24px;
	white-space: nowrap;
	font-size: 12px;
}
.card {
	border: 1px solid #e8e7df;
	background: #fffef9;
	border-radius: 20px;
	padding: 24px;
	min-width: 0;
}
.case-columns {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 20px;
	align-items: start;
}
.card > summary {
	font-size: 15px;
}
.card[open] > summary {
	margin-bottom: 20px;
}
label {
	display: grid;
	gap: 6px;
	font-size: 12px;
	color: #657b76;
	margin-bottom: 14px;
}
input,
textarea {
	width: 100%;
	min-width: 0;
	border: 1px solid #dadfd7;
	border-radius: 10px;
	padding: 11px 13px;
	background: #fafaf4;
	color: #233043;
	font: inherit;
	font-size: 14px;
	box-sizing: border-box;
}
textarea {
	resize: vertical;
}
button {
	border: 1px solid #dce0d6;
	border-radius: 10px;
	background: #fffef9;
	color: #233043;
	padding: 10px 14px;
	font-size: 13px;
	cursor: pointer;
}
button:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}
button:focus-visible,
input:focus-visible,
textarea:focus-visible,
summary:focus-visible {
	outline: 2px solid #526f64;
	outline-offset: 3px;
}
.primary {
	background: #223043;
	color: #fff;
	border-color: #223043;
}
.quiet {
	background: transparent;
	margin: 10px 0;
}
.actions {
	flex-wrap: wrap;
	margin: 14px 0;
}
form {
	margin-bottom: 8px;
}
form button {
	white-space: nowrap;
}
.result {
	width: 100%;
	text-align: left;
	justify-content: space-between;
	margin-top: 12px;
}
.result b {
	display: block;
}
.result span:last-child {
	white-space: nowrap;
	font-size: 12px;
}
.evidence {
	border-top: 1px solid #e4e7df;
	padding: 14px 0;
}
summary {
	cursor: pointer;
	font-size: 14px;
}
.evidence summary {
	margin-bottom: 10px;
}
.case-shelf {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}
.chosen {
	border-color: #587868;
	background: #eaf0e7;
}
ol {
	list-style: none;
	padding: 0;
	display: grid;
	gap: 12px;
}
li {
	border: 1px solid #dae2d8;
	border-radius: 14px;
	padding: 16px;
}
li.ideal {
	border: 1px dashed #a69366;
	background: #faf5e8;
}
.step-title input {
	flex: 1;
}
.step-title small {
	white-space: nowrap;
}
.ideal-fields {
	display: grid;
	grid-template-columns: 1fr 1fr 1fr;
	gap: 12px;
	margin-top: 12px;
}
.scenario {
	border-radius: 12px;
	background: #f1f0e6;
	padding: 18px;
	margin-top: 14px;
}
.scenario div {
	display: flex;
	justify-content: space-between;
	padding: 8px 0;
	gap: 12px;
}
.scenario span {
	color: #7e704e;
	font-size: 12px;
}
.error {
	padding: 12px;
	background: #f9e8df;
	border-radius: 10px;
	color: #9c412c;
}
.notice {
	padding: 12px;
	background: #e8f0e4;
	border-radius: 10px;
}
@media (max-width: 950px) {
	.case-columns,
	.ideal-fields {
		grid-template-columns: 1fr;
	}
	.case-heading,
	.step-title {
		flex-wrap: wrap;
	}
	.step-title input {
		flex-basis: 60%;
	}
}
@media (max-width: 550px) {
	.case-heading > div {
		flex-basis: 100%;
	}
	form {
		flex-wrap: wrap;
	}
	h2 {
		font-size: 28px;
	}
	.card {
		padding: 16px;
	}
	.scenario div {
		display: grid;
	}
}
</style>
