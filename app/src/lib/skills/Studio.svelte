<script lang="ts">
import type { PlanRunRecord } from '@avenos/actors'
import {
	parseStudioDefinition,
	STUDIO_CATALOG,
	type StudioDefinition,
	type StudioType,
	sameType
} from '@avenos/actors/studio'
import { onMount } from 'svelte'
import {
	refreshStudio,
	type StudioArtifact,
	type StudioConnection,
	type StudioDraft,
	type StudioExploration,
	type StudioPreview,
	studio,
	studioName,
	studioRequest
} from './studio.svelte'

let tab = $state<'explore' | 'build' | 'activity'>('explore')
let busy = $state(false)
let error = $state('')
let notice = $state('')
let search = $state('')
let lookupId = $state('')
let exploration = $state<StudioExploration | null>(null)
let selected = $state<StudioArtifact | null>(null)
let draft = $state<StudioDraft | null>(null)
let definition = $state<StudioDefinition | null>(null)
let preview = $state<StudioPreview | null>(null)
let bindings = $state<Record<string, string>>({})
let inspectorDialog: HTMLDialogElement | undefined = $state()
let inspecting = $state<Record<string, unknown> | null>(null)
let raw = $state('')
let budget = $state(1)
let comparison = $state<{ baseline: StudioPreview; variants: StudioPreview[] } | null>(null)
let sourceFilter = $state('')
let watchPort = $state('source')
let showConnection = $state(false)
let pendingSample: { requestId: string; observedAt: string } | null = null
let pendingRun: {
	requestId: string
	skillArtifactId: string
	inputs: Record<string, string>
} | null = null
let pendingConnection: Record<string, unknown> | null = null
let workspaceKey = ''
let disposed = false
let explorationSequence = 0
const snapshot = $derived(studio.snapshot)
const reusableSkills = $derived(
	(snapshot?.skills ?? []).flatMap((artifact) => {
		try {
			return [{ artifact, definition: parseStudioDefinition(artifact.payload) }]
		} catch {
			return []
		}
	})
)
const siblings = $derived(
	(
		inspecting?.production as
			| { publication?: { artifacts?: Array<{ artifactId: string; localKey: string }> } }
			| undefined
	)?.publication?.artifacts ?? []
)
const dirty = $derived(
	!!definition && JSON.stringify(definition) !== JSON.stringify(draft?.definition)
)
const conflict = $derived(
	!!draft && !!snapshot?.drafts.some((d) => d.id === draft!.id && d.revision !== draft!.revision)
)
const published = $derived(
	!dirty && draft?.published_revision === draft?.revision ? draft?.published_artifact_id : null
)
const artifacts = $derived(
	(snapshot?.artifacts ?? []).filter((a) =>
		(studioName(a) + a.typeKey).toLowerCase().includes(search.toLowerCase())
	)
)
const portNames = $derived(Object.keys(definition?.inputs ?? {}))
const compatible = (a: StudioArtifact, type: StudioType) =>
	sameType({ key: a.typeKey, version: a.typeVersion }, type)
const readableType = (t: StudioType) =>
	({
		'core.file': 'File',
		'studio.understanding': 'Understanding',
		'studio.brief': 'Brief',
		'studio.email': 'Email',
		'studio.skill': 'Skill'
	})[t.key] ?? t.key
const candidates = (type: StudioType) => [
	...new Map(
		[...(snapshot?.artifacts ?? []), ...(snapshot?.files ?? []), ...(selected ? [selected] : [])]
			.filter((a) => compatible(a, type))
			.map((a) => [a.artifactId, a])
	).values()
]
const runArtifact = (run: PlanRunRecord): StudioArtifact | null =>
	(run.checkpoints.at(-1)?.output as { artifact?: StudioArtifact } | undefined)?.artifact ?? null

async function act(fn: () => Promise<void>) {
	if (busy) return
	busy = true
	error = ''
	notice = ''
	try {
		await fn()
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
	} finally {
		busy = false
	}
}
async function explore(id: string) {
	const sequence = ++explorationSequence
	error = ''
	try {
		const result = await studioRequest<StudioExploration>('explore', { artifactId: id })
		if (sequence !== explorationSequence || disposed) return
		exploration = result
		selected = result.source
		tab = 'explore'
	} catch (e) {
		if (sequence === explorationSequence) error = String(e)
	}
}
function create(def: StudioDefinition) {
	definition = structuredClone($state.snapshot(def))
	draft = {
		id: crypto.randomUUID(),
		revision: 0,
		definition: structuredClone($state.snapshot(def)),
		published_artifact_id: null,
		published_revision: null
	}
	bindings =
		selected && def.inputs.source && compatible(selected, def.inputs.source)
			? { source: selected.artifactId }
			: {}
	raw = JSON.stringify(def, null, 2)
	comparison = null
	tab = 'build'
}
function openDraft(value: StudioDraft) {
	draft = structuredClone($state.snapshot(value))
	definition = structuredClone($state.snapshot(value.definition))
	bindings = {}
	comparison = null
	tab = 'build'
	raw = JSON.stringify(value.definition, null, 2)
	if (selected)
		for (const [name, type] of Object.entries(value.definition.inputs))
			if (compatible(selected, type)) bindings[name] = selected.artifactId
}
function chooseSaved(artifact: StudioArtifact) {
	const found = snapshot?.drafts.find((d) => d.published_artifact_id === artifact.artifactId)
	if (found) openDraft(found)
	else create(parseStudioDefinition(artifact.payload))
}
function wrapSkill(artifact: StudioArtifact) {
	const child = parseStudioDefinition(artifact.payload)
	create({
		...child,
		name: child.name + ' workflow',
		steps: [
			{
				id: 'child',
				kind: 'skill',
				label: child.name,
				ref: artifact.artifactId,
				inputs: Object.fromEntries(
					Object.keys(child.inputs).map((name) => [name, { kind: 'input', name }])
				),
				parameters: {}
			}
		],
		output: { type: child.output.type, from: { kind: 'step', name: 'child' } }
	})
}
function removeLastStep() {
	if (!definition) return
	const step = definition.steps.at(-1)
	if (!step || Object.keys(step.inputs).length !== 1) return
	const from = Object.values(step.inputs)[0]
	const type =
		from.kind === 'input'
			? definition.inputs[from.name]
			: preview?.program?.steps.find((s) => s.id === from.name)?.outputType
	if (!type) return
	definition.steps.pop()
	definition.output = { type, from }
}
async function save() {
	if (!definition || !draft) return
	if (draft.revision > 0 && !dirty) return
	draft = await studioRequest<StudioDraft>('draft', {
		id: draft.id,
		revision: draft.revision,
		definition: $state.snapshot(definition)
	})
	await refreshStudio()
	notice = 'Draft saved'
}
async function publish() {
	await save()
	if (!draft) return
	draft = await studioRequest<StudioDraft>('publish', { id: draft.id, revision: draft.revision })
	await refreshStudio()
	notice = 'Skill published · exact revision saved'
}
function append(ref: string, kind: 'capability' | 'skill') {
	if (!definition) return
	const cap = STUDIO_CATALOG.find((c) => c.id === ref)
	const skill = snapshot?.skills.find((a) => a.artifactId === ref)
	const child = skill ? parseStudioDefinition(skill.payload) : null
	const type = cap?.output ?? child?.output.type
	if (!type) return
	const inputName = child ? Object.keys(child.inputs)[0] : 'source'
	if (!inputName) return
	const id = 'step-' + crypto.randomUUID().slice(0, 8)
	definition.steps.push({
		id,
		kind,
		label: cap?.label ?? child!.name,
		inputs: { [inputName]: structuredClone($state.snapshot(definition.output.from)) },
		parameters: {},
		ref
	})
	definition.output = { type, from: { kind: 'step', name: id } }
}
function pin(index: number) {
	if (!definition) return
	const step = definition.steps[index]
	const resolved = preview?.program?.steps[index]
	if (!step || !resolved?.capabilities?.length) return
	const route = resolved.capabilities
	definition.steps.splice(
		index,
		1,
		...route.map((c, i) => ({
			id: i === route.length - 1 ? step.id : step.id + '-part-' + i,
			kind: 'capability' as const,
			label: c.label,
			ref: c.id,
			parameters: {},
			inputs: {
				source:
					i === 0
						? step.inputs.source
						: { kind: 'step' as const, name: step.id + '-part-' + (i - 1) }
			}
		}))
	)
}
async function inspect(id: string) {
	inspecting = await studioRequest<Record<string, unknown>>('inspect', { artifactId: id })
}
async function sample() {
	pendingSample ??= { requestId: crypto.randomUUID(), observedAt: new Date().toISOString() }
	const result = await studioRequest<{ artifacts: StudioArtifact[] }>('sample', pendingSample)
	pendingSample = null
	await refreshStudio()
	const file = result.artifacts.find((a) => a.typeKey === 'core.file')
	if (file) await explore(file.artifactId)
	notice = 'Sample email and attachment saved'
}
async function run() {
	if (!published) return
	const inputs = $state.snapshot(bindings)
	if (
		!pendingRun ||
		pendingRun.skillArtifactId !== published ||
		JSON.stringify(pendingRun.inputs) !== JSON.stringify(inputs)
	)
		pendingRun = { requestId: crypto.randomUUID(), skillArtifactId: published, inputs }
	await studioRequest('start', pendingRun)
	pendingRun = null
	tab = 'activity'
	await refreshStudio()
}
async function connect() {
	if (!published || !definition) return
	const data = {
		name: definition.name,
		skillArtifactId: published,
		sourceArtifactId: sourceFilter || null,
		inputPort: watchPort,
		fixedInputs: Object.fromEntries(
			Object.entries(bindings).filter(([name]) => name !== watchPort)
		),
		enabled: true
	}
	if (
		!pendingConnection ||
		JSON.stringify({ ...pendingConnection, id: undefined }) !== JSON.stringify(data)
	)
		pendingConnection = { ...data, id: crypto.randomUUID() }
	await studioRequest('connect', pendingConnection)
	pendingConnection = null
	showConnection = false
	tab = 'activity'
	await refreshStudio()
	notice = 'Connected · new artifacts from now on'
}
async function control(c: StudioConnection) {
	await studioRequest('control', { id: c.id, revision: c.revision, enabled: !c.enabled })
	await refreshStudio()
}
async function controlRun(run: PlanRunRecord, action: 'retry' | 'cancel') {
	await studioRequest('run-control', { runId: run.runId, requestId: crypto.randomUUID(), action })
	await refreshStudio()
}
async function sync() {
	await studioRequest('sync')
	await refreshStudio()
}

$effect(() => {
	if (!snapshot?.scopeId || !snapshot.subjectId) return
	const key = snapshot.scopeId + '/' + snapshot.subjectId
	if (workspaceKey && workspaceKey !== key) {
		selected = null
		exploration = null
		draft = null
		definition = null
		inspecting = null
		bindings = {}
		pendingSample = null
		pendingRun = null
		pendingConnection = null
		tab = 'explore'
		error = ''
		notice = ''
	}
	workspaceKey = key
})
$effect(() => {
	if (inspecting && inspectorDialog && !inspectorDialog.open) inspectorDialog.showModal()
})
$effect(() => {
	const request = studio.requestedArtifactId
	if (request) {
		studio.requestedArtifactId = null
		void explore(request)
	}
})
$effect(() => {
	studio.refreshVersion
	void refreshStudio().catch((e) => {
		error = String(e)
	})
})
$effect(() => {
	const text = JSON.stringify(definition)
	preview = null
	comparison = null
	if (!definition) return
	let cancelled = false
	const timer = setTimeout(() => {
		void studioRequest<StudioPreview>('preview', { definition: JSON.parse(text) })
			.then((p) => {
				if (!cancelled) preview = p
			})
			.catch((e) => {
				if (!cancelled) error = String(e)
			})
	}, 300)
	return () => {
		cancelled = true
		clearTimeout(timer)
	}
})
onMount(() => {
	let syncing = false
	const timer = setInterval(async () => {
		if (syncing || busy || document.visibilityState !== 'visible') return
		syncing = true
		try {
			if (snapshot?.connections.some((c) => c.enabled)) await sync()
			else await refreshStudio()
		} catch (e) {
			if (!disposed) error = String(e)
		} finally {
			syncing = false
		}
	}, 6000)
	return () => {
		disposed = true
		clearInterval(timer)
	}
})
</script>

<section class="studio" aria-label="Skill Studio">
	<header class="studio-head">
		<div class="brand">
			<span class="brand-mark" aria-hidden="true">✳</span>
			<div>
				<h1>Skill Studio</h1>
				<p>Turn what you have into what you need.</p>
			</div>
		</div>
		<div class="header-actions">
			<span class="session"><i></i> Session dispatch</span
			><button class="quiet" disabled={busy} onclick={() => act(sync)} aria-label="Refresh Studio">
				↻
			</button><button class="secondary" disabled={busy} onclick={() => act(sample)}>
				＋ Sample email
			</button>
		</div>
	</header>
	<nav class="tabs" aria-label="Studio views">
		{#each [{ id: 'explore', label: 'Explore', icon: '◈' }, { id: 'build', label: 'Compose', icon: '⌘' }, { id: 'activity', label: 'Activity', icon: '↗' }] as item}
			<button
				class:active={tab === item.id}
				aria-current={tab === item.id ? 'page' : undefined}
				onclick={() => tab = item.id as typeof tab}
			>
				<span aria-hidden="true">{item.icon}</span>
				{item.label}
				{#if item.id === 'activity' && snapshot?.connections.length}
					<small>{snapshot.connections.length}</small>
				{/if}
			</button>
		{/each}
		<span class="tab-hint">{busy ? 'Saving your changes…' : 'Every result keeps its history'}</span>
	</nav>
	{#if error}
		<div class="message warning" role="alert">
			<span>{error}</span
			><button onclick={() => act(async () => { await refreshStudio() })}>Try again</button>
		</div>
	{/if}
	{#if notice}
		<div class="message success" role="status">✓ {notice}</div>
	{/if}
	<div class="workspace">
		<aside class="shelf">
			<div class="section-label">
				Your material <span>{snapshot?.artifacts.length ?? '—'}</span>
			</div>
			<label class="search"
				><span aria-hidden="true">⌕</span>
				<input
					bind:value={search}
					placeholder="Find an artifact"
					aria-label="Find an artifact"
				></label
			>
			<div class="shelf-items">
				{#each artifacts as a (a.artifactId)}
					<button
						class="material"
						class:chosen={selected?.artifactId === a.artifactId}
						onclick={() => explore(a.artifactId)}
					>
						<span class="material-icon" aria-hidden="true"
							>{a.typeKey === 'studio.skill' ? '⌘' : a.typeKey === 'studio.email' ? '✉' : '▤'}</span
						><span
							><strong>{studioName(a)}</strong
							><small>{readableType({ key: a.typeKey, version: a.typeVersion })}</small></span
						><span class="chevron" aria-hidden="true">›</span>
					</button>
				{:else}
					<p class="muted shelf-empty">
						{snapshot ? 'Start with a sample email, or choose a file in Artifacts.' : 'Connecting to your workspace…'}
					</p>
				{/each}
			</div>
			<details class="lookup">
				<summary>Find by artifact ID</summary>
				<form onsubmit={e => { e.preventDefault(); void explore(lookupId) }}>
					<input aria-label="Artifact ID" placeholder="Artifact ID" bind:value={lookupId}>
					<button class="quiet">Go →</button>
				</form>
				<p class="muted">The shelf shows the first 128 artifacts. Any exact ID can be explored.</p>
			</details>
			<div class="section-label library-label">
				Saved programs <span>{snapshot?.drafts.length ?? 0}</span>
			</div>
			{#each snapshot?.drafts ?? [] as d (d.id)}
				<button
					class="draft-link"
					class:chosen={draft?.id === d.id && tab === 'build'}
					onclick={() => openDraft(d)}
				>
					<span aria-hidden="true">{d.published_revision === d.revision ? '◇' : '◌'}</span
					><span>{d.definition.name}</span
					><small>{d.published_revision === d.revision ? 'Published' : 'Draft'}</small>
				</button>
			{/each}
		</aside>
		<main class="canvas">
			{#if tab === 'explore'}
				<div class="canvas-heading">
					<span class="eyebrow">01 / Possibilities</span>
					<h2>{selected ? 'What could this become?' : 'Start with something real.'}</h2>
					<p class="muted">
						{selected ? studioName(selected) : 'Pick an artifact, or capture a sample email to try the full path.'}
					</p>
				</div>
				{#if !selected}
					<div class="start-card">
						<div class="orbit" aria-hidden="true">
							<span>✉</span><b>→</b><span>▤</span><b>→</b><span>✳</span>
						</div>
						<h3>One email. Many possibilities.</h3>
						<p class="muted">
							Explore its attachment, compose a Skill, then connect it to future arrivals.
						</p>
						<button class="primary" disabled={busy} onclick={() => act(sample)}>
							Try a sample email <span aria-hidden="true">↗</span>
						</button><small>No mailbox connection or model call.</small>
					</div>
				{:else}
					<div class="subject-card">
						<span class="subject-icon" aria-hidden="true">▤</span>
						<div>
							<strong>{studioName(selected)}</strong>
							<p class="muted">
								{readableType({ key: selected.typeKey, version: selected.typeVersion })}
								· committed artifact
							</p>
						</div>
						<button class="quiet" onclick={() => act(() => inspect(selected!.artifactId))}>
							Inspect ↗
						</button>
					</div>
					<div class="opportunities">
						{#each exploration?.opportunities ?? [] as opportunity, index}
							<button class="opportunity" onclick={() => create(opportunity.definition)}>
								<span class="opportunity-index">0{index + 1}</span>
								<div>
									<h3>{opportunity.label}</h3>
									<div class="mini-route">
										{#each opportunity.steps as step}
											<span>{step.label}</span>
										{/each}
									</div>
									<small class:conditional={opportunity.conditional}
										>{opportunity.conditional ? '◐ Findings depend on the document' : '✓ Deterministic transformation'}</small
									>
								</div>
								<span class="arrow" aria-hidden="true">↗</span>
							</button>
						{:else}
							<div class="start-card compact">
								<h3>No installed route yet.</h3>
								<p class="muted">
									This type is inspectable. More capabilities can extend what it can become.
								</p>
								<button class="secondary" onclick={() => act(() => inspect(selected!.artifactId))}>
									Explore its provenance
								</button>
								{#if selected.typeKey === 'studio.skill'}
									<button class="primary" onclick={() => act(async () => chooseSaved(selected!))}>
										Open this Skill
									</button><button
										class="secondary"
										onclick={() => act(async () => wrapSkill(selected!))}
									>
										Use as a child Skill
									</button>
								{/if}
							</div>
						{/each}
					</div>
					<p class="footnote">
						Routes use the installed catalog. Previews never run steps or invent findings.
					</p>
				{/if}
			{:else if tab === 'build'}
				{#if definition && draft}
					<div class="compose-head">
						<div>
							<span class="eyebrow">02 / Compose</span>
							<input
								class="program-name"
								aria-label="Program name"
								bind:value={definition.name}
								maxlength="160"
							>
							<p class="muted">
								{published ? 'Published revision ' + draft.revision : 'Draft · changes are yours until saved'}
							</p>
						</div>
						<button class="secondary" disabled={busy} onclick={() => act(save)}>Save draft</button>
					</div>
					{#if conflict}
						<div class="message warning" role="alert">
							Another client edited this draft. Your local edits are still here.<button
								onclick={() => { const latest = snapshot?.drafts.find(d => d.id === draft!.id); if (latest) openDraft(latest) }}
							>
								Load latest
							</button><button onclick={() => create($state.snapshot(definition!))}>
								Keep as copy
							</button>
						</div>
					{/if}
					<div class="program-flow">
						<div class="studio-flow-card">
							<span class="node-icon">↓</span>
							<div class="node-body">
								<span class="eyebrow">Given</span>
								{#each Object.entries(definition.inputs) as [name, type]}
									<label class="binding"
										><span>{name} <small>{readableType(type)}</small></span
										><select aria-label={'Input ' + name} bind:value={bindings[name]}>
											<option value="">Choose an artifact…</option>
											{#each candidates(type) as a (a.artifactId)}
												<option value={a.artifactId}>{studioName(a)}</option>
											{/each}
										</select></label
									>
								{/each}
							</div>
						</div>
						{#each definition.steps as step, index (step.id)}
							<div class="studio-flow-line" aria-hidden="true"></div>
							<div class="studio-flow-card" class:open-goal={step.kind === 'goal'}>
								<span class="node-icon"
									>{step.kind === 'goal' ? '✳' : step.kind === 'skill' ? '⌘' : step.kind === 'review' ? '◐' : '◇'}</span
								>
								<div class="node-body">
									<span class="eyebrow"
										>{step.kind === 'goal' ? 'Solver fills this' : step.kind === 'skill' ? 'Reusable Skill · exact revision' : step.kind === 'review' ? 'Review · not executable yet' : 'Fixed step'}</span
									><input
										aria-label={'Step ' + (index + 1) + ' label'}
										class="step-name"
										bind:value={step.label}
									>
									<div class="mini-route">
										{#each preview?.program?.steps[index]?.capabilities ?? [] as c}
											<span>{c.label}</span>
										{/each}
									</div>
									{#if step.ref === 'report.brief@1'}
										<label class="binding"
											>Brief title<input
												aria-label="Brief title"
												value={String(step.parameters.title ?? '')}
												oninput={e => { const value = e.currentTarget.value; if (value.trim()) step.parameters.title = value; else delete step.parameters.title }}
												placeholder="Document brief"
											></label
										>
									{/if}
									<details class="step-details">
										<summary>Bindings & details</summary>
										<p>
											{Object.entries(step.inputs).map(([port, value]) => port + ' ← ' + value.kind + ':' + value.name).join(' · ')}
										</p>
										{#if step.kind === 'skill'}
											<button class="quiet" onclick={() => act(() => inspect(step.ref!))}>
												Inspect child Skill ↗
											</button>
										{/if}
									</details>
								</div>
								{#if step.kind === 'goal'}
									<button class="quiet" disabled={!preview?.ok} onclick={() => pin(index)}>
										Lock route
									</button>
								{/if}
								{#if index === definition.steps.length - 1 && Object.keys(step.inputs).length === 1}
									<button
										class="quiet"
										aria-label={'Remove step ' + (index + 1)}
										onclick={removeLastStep}
									>
										×
									</button>
								{/if}
							</div>
						{/each}
						<div class="studio-flow-line" aria-hidden="true"></div>
						<div class="studio-flow-card output-card">
							<span class="node-icon">↗</span>
							<div>
								<span class="eyebrow">Then I have</span>
								<h3>{readableType(definition.output.type)}</h3>
								<p class="muted">
									{preview?.program?.conditional ? 'A recorded result. Findings may still need review.' : 'A committed artifact, with its provenance.'}
								</p>
							</div>
						</div>
					</div>
					<div class="extend">
						<span class="muted">Continue with</span>
						{#each STUDIO_CATALOG.filter(c => sameType(c.input, definition!.output.type)) as c}
							<button class="chip" onclick={() => append(c.id, 'capability')}>＋ {c.label}</button>
						{/each}
						{#each reusableSkills as saved}
							{@const child = saved.definition}
							{#if Object.keys(child.inputs).length === 1 && sameType(Object.values(child.inputs)[0], definition.output.type)}
								<button class="chip" onclick={() => append(saved.artifact.artifactId, 'skill')}>
									⌘ {child.name}
								</button>
							{/if}
						{/each}
					</div>
					<div class="policy-row">
						<label class="toggle"
							><input type="checkbox" bind:checked={definition.policy.allowModel}>Allow model
							assistance</label
						><span class="muted"
							>{definition.policy.allowModel ? 'May use the configured model lane' : 'Deterministic inspection only'}</span
						>
					</div>
					{#if preview?.ok}
						<div class="plan-status" role="status">
							<span>✓ Ready to publish</span
							><small
								>{preview.program?.invocations}
								program calls · nesting ≤ {definition.policy.maxDepth}</small
							>
						</div>
					{:else if preview}
						<div class="message warning" role="status">
							{preview.issues?.map(i => i.message).join(' ')}
						</div>
					{:else}
						<p class="muted" role="status">Checking the plan…</p>
					{/if}
					<details class="what-if">
						<summary><span>◌ What if…</span><small>Plan only · no execution</small></summary>
						<div class="what-if-body">
							<label
								>Limit program calls to
								<input type="number" min="1" max="64" bind:value={budget}></label
							><button
								class="secondary"
								disabled={busy}
								onclick={() => act(async () => { comparison = await studioRequest('compare', { baseline: $state.snapshot(definition), variants: [{ ...$state.snapshot(definition!), policy: { ...definition!.policy, maxInvocations: budget } }] }) })}
							>
								Compare
							</button>
						</div>
						{#if comparison}
							<div class="comparison">
								<div>
									<small>Current</small
									><strong>{comparison.baseline.ok ? 'Feasible' : 'Needs changes'}</strong>
								</div>
								<span>→</span>
								<div>
									<small>{budget} calls</small
									><strong>{comparison.variants[0]?.ok ? 'Feasible' : 'Over budget'}</strong>
								</div>
							</div>
						{/if}
					</details>
					<details
						class="advanced"
						ontoggle={e => { if (e.currentTarget.open) raw = JSON.stringify($state.snapshot(definition), null, 2) }}
					>
						<summary>Full program · editable by you and the agent</summary>
						<textarea aria-label="Full program JSON" bind:value={raw} spellcheck="false"></textarea
						><button
							class="secondary"
							onclick={() => { try { definition = parseStudioDefinition(JSON.parse(raw)); error = '' } catch (e) { error = String(e) } }}
						>
							Apply to draft
						</button>
					</details>
					<div class="compose-actions">
						<button
							class="secondary"
							disabled={busy || !published}
							onclick={() => { watchPort = portNames[0]; showConnection = !showConnection }}
						>
							Connect to arrivals
						</button><span></span
						><button
							class="secondary"
							disabled={busy || !preview?.ok || conflict}
							onclick={() => act(publish)}
						>
							{published ? 'Publish new revision' : 'Publish Skill'}
						</button><button
							class="primary"
							disabled={busy || !published || portNames.some(p => !bindings[p])}
							onclick={() => act(run)}
						>
							Run Skill ↗
						</button>
					</div>
					{#if !published}
						<p class="footnote">Publish a revision to run it or connect it to arrivals.</p>
					{/if}
					{#if showConnection}
						<div class="connection-editor">
							<h3>When a new artifact arrives…</h3>
							<label
								>Feed input<select aria-label="Trigger input" bind:value={watchPort}>
									{#each portNames as port}
										<option value={port}>{port}</option>
									{/each}
								</select></label
							><label
								>From<select aria-label="Source filter" bind:value={sourceFilter}>
									<option value="">Any committed artifact</option>
									{#each snapshot?.sources ?? [] as s}
										<option value={s.artifactId}>{studioName(s)}</option>
									{/each}
								</select></label
							>
							<p class="muted">
								Starts with future arrivals. Other inputs stay fixed. Dispatch advances while Studio
								is open or the agent syncs it.
							</p>
							<button
								class="primary"
								disabled={busy || portNames.some(p => p !== watchPort && !bindings[p])}
								onclick={() => act(connect)}
							>
								Enable connection ↗
							</button>
						</div>
					{/if}
				{:else}
					<div class="start-card">
						<div class="empty-symbol" aria-hidden="true">⌘</div>
						<h2>Small steps. Useful programs.</h2>
						<p class="muted">
							Start from an artifact and choose an outcome. The solver will find a route you can
							shape.
						</p>
						<button class="primary" onclick={() => tab = 'explore'}>Explore possibilities ↗</button>
					</div>
				{/if}
			{:else}
				<div class="canvas-heading">
					<span class="eyebrow">03 / In motion</span>
					<h2>Connected work.</h2>
					<p class="muted">Durable rules. Visible results. Dispatch uses your active session.</p>
				</div>
				<div class="section-label">
					Connections <span>{snapshot?.connections.length ?? 0}</span>
				</div>
				{#each snapshot?.connections ?? [] as c (c.id)}
					<div class="connection">
						<span class="connection-dot" class:paused={!c.enabled}></span>
						<div>
							<h3>{c.record.name}</h3>
							<p class="muted">
								{readableType(c.record.inputType)}
								→ Skill · {c.enabled ? 'Watching in this session' : 'Paused · cursor retained'}
							</p>
							{#if c.last_error}
								<p class="error-text">{c.last_error}</p>
							{/if}
						</div>
						<button class="quiet" onclick={() => act(() => inspect(c.record.skillArtifactId))}>
							Inspect
						</button><button
							class="secondary"
							disabled={busy}
							onclick={() => act(() => control(c))}
						>
							{c.enabled ? 'Pause' : 'Resume'}
						</button>
					</div>
				{:else}
					<div class="empty-row">
						<span aria-hidden="true">⤳</span>
						<p>Publish a Skill, then connect it to incoming artifacts.</p>
						<button class="quiet" onclick={() => tab = 'build'}>Compose →</button>
					</div>
				{/each}
				{#if snapshot?.deliveries.length}
					<p class="message warning">
						{snapshot.deliveries.length}
						queued arrivals.{snapshot.deliveries.find(d => d.last_error)?.last_error ?? ' Dispatch resumes while your session is active.'}
					</p>
				{/if}
				<div class="section-label activity-label">
					Recent runs <span>{snapshot?.runs.length ?? 0}</span>
				</div>
				{#each snapshot?.runs ?? [] as r (r.runId)}
					{@const output = runArtifact(r)}
					<article class="run-card">
						<div class="run-top">
							<span class="run-state" class:failed={r.state === 'failed'}
								>{r.state === 'succeeded' ? '✓' : r.state === 'failed' ? '!' : '◌'}
								{r.state.replaceAll('_', ' ')}</span
							><small>{new Date(r.createdAt).toLocaleString()}</small>
						</div>
						<h3>{output ? studioName(output) : 'Skill run'}</h3>
						{#if output}
							<p>{String(output.payload.summary ?? 'Result committed.')}</p>
							<div class="result-actions">
								<span class="result-status"
									>{output.payload.status === 'partial' ? '◐ Review findings' : '◇ Provenance preserved'}</span
								><button class="quiet" onclick={() => act(() => inspect(output.artifactId))}>
									Trace result ↗
								</button><button class="secondary" onclick={() => explore(output.artifactId)}>
									Explore next →
								</button>
							</div>
						{:else}
							<p class="muted">
								{r.state === 'failed' ? String(r.failure?.message ?? 'The run stopped. Inspect the details before retrying.') : 'The accepted run is processing on the server.'}
							</p>
						{/if}
						{#if r.state === 'failed'}
							<button
								class="secondary"
								disabled={busy}
								onclick={() => act(() => controlRun(r, 'retry'))}
							>
								Retry same run ↻
							</button>
						{:else if ['accepted', 'planning', 'running', 'waiting_for_input'].includes(r.state)}
							<button
								class="quiet"
								disabled={busy}
								onclick={() => act(() => controlRun(r, 'cancel'))}
							>
								Stop run
							</button>
						{/if}
						<details>
							<summary>Run details</summary>
							<pre>{JSON.stringify(r, null, 2)}</pre>
						</details>
					</article>
				{:else}
					<div class="empty-row">
						<span aria-hidden="true">↗</span>
						<p>Your first result starts with a published Skill.</p>
					</div>
				{/each}
			{/if}
		</main>
	</div>
	{#if inspecting}
		<dialog
			class="inspector"
			bind:this={inspectorDialog}
			aria-label="Artifact inspector"
			onclose={() => inspecting = null}
		>
			<header>
				<div>
					<span class="eyebrow">Evidence, not a black box</span>
					<h2>Artifact & provenance</h2>
				</div>
				<button class="quiet" aria-label="Close inspector" onclick={() => inspecting = null}>
					✕
				</button>
			</header>
			<p class="muted">Immutable content and the exact inputs that produced it.</p>
			{#if siblings.length > 1}
				<div class="provenance-links" aria-label="Same publication">
					{#each siblings as sibling}
						<button class="chip" onclick={() => act(() => inspect(sibling.artifactId))}>
							{sibling.localKey}
							↗
						</button>
					{/each}
				</div>
			{/if}
			{#if Array.isArray(inspecting.inputs)}
				<div class="provenance-links">
					{#each inspecting.inputs as input}
						{#if typeof input.artifactId === 'string'}
							<button class="chip" onclick={() => act(() => inspect(input.artifactId))}>
								{input.role ?? 'Input'}
								↗
							</button>
						{/if}
					{/each}
				</div>
			{/if}
			<pre>{JSON.stringify(inspecting, null, 2)}</pre>
			<button
				class="secondary"
				onclick={() => { const a = inspecting?.artifact as StudioArtifact | undefined; if (a) { inspecting = null; void explore(a.artifactId) } }}
			>
				Explore this artifact →
			</button>
		</dialog>
	{/if}
</section>

<style>
.studio {
	--ink: var(--color-foreground, #243b34);
	--muted: color-mix(in srgb, var(--ink) 57%, transparent);
	--line: color-mix(in srgb, var(--ink) 12%, transparent);
	--paper: var(--color-surface-raised, #fffdf8);
	--green: var(--color-primary, #326552);
	display: flex;
	flex: 1;
	min-height: 0;
	min-width: 0;
	flex-direction: column;
	color: var(--ink);
	background: var(--paper);
	border: 1px solid var(--line);
	border-radius: 20px;
	overflow: hidden;
	font-size: 13px;
}
.studio :global(button),
.studio input,
.studio select,
.studio textarea {
	font: inherit;
}
.studio button {
	cursor: pointer;
	transition:
		background 0.15s,
		transform 0.15s;
}
.studio button:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}
.studio button:focus-visible,
.studio input:focus-visible,
.studio select:focus-visible,
.studio summary:focus-visible,
.studio textarea:focus-visible {
	outline: 2px solid var(--green);
	outline-offset: 3px;
}
.studio h1,
.studio h2,
.studio h3,
.studio p {
	margin: 0;
}
.studio h1 {
	font-size: 19px;
	letter-spacing: -0.6px;
	font-weight: 650;
}
.studio h2 {
	font-size: 28px;
	font-weight: 550;
	letter-spacing: -1px;
	line-height: 1.2;
}
.studio h3 {
	font-size: 15px;
	font-weight: 600;
}
.studio small {
	font-size: 11px;
}
.muted {
	color: var(--muted);
	line-height: 1.6;
}
.studio-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	padding: 24px 28px 20px;
}
.brand {
	display: flex;
	align-items: center;
	gap: 13px;
}
.brand p {
	color: var(--muted);
	font-size: 12px;
	margin-top: 3px;
}
.brand-mark {
	display: grid;
	place-items: center;
	width: 42px;
	height: 42px;
	border-radius: 13px;
	background: var(--green);
	color: var(--paper);
	font-size: 30px;
}
.header-actions {
	display: flex;
	align-items: center;
	gap: 10px;
}
.session {
	display: flex;
	align-items: center;
	gap: 6px;
	color: var(--muted);
	font-size: 11px;
}
.session i,
.connection-dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: #5d8e75;
}
.tabs {
	display: flex;
	align-items: center;
	gap: 5px;
	padding: 0 28px 14px;
	border-bottom: 1px solid var(--line);
}
.tabs button {
	display: flex;
	gap: 8px;
	align-items: center;
	padding: 8px 15px;
	border: 0;
	background: transparent;
	border-radius: 9px;
	color: var(--muted);
}
.tabs button.active {
	color: var(--ink);
	background: color-mix(in srgb, var(--green) 11%, transparent);
}
.tabs small {
	padding: 0 5px;
	background: var(--paper);
	border-radius: 5px;
}
.tab-hint {
	margin-left: auto;
	font-size: 11px;
	color: var(--muted);
}
.workspace {
	display: flex;
	flex: 1;
	min-height: 0;
}
.shelf {
	width: 242px;
	flex-shrink: 0;
	border-right: 1px solid var(--line);
	padding: 22px 14px;
	overflow-y: auto;
	background: color-mix(in srgb, var(--green) 2%, var(--paper));
}
.section-label {
	display: flex;
	justify-content: space-between;
	text-transform: uppercase;
	letter-spacing: 1.4px;
	font-size: 10px;
	font-weight: 600;
	color: var(--muted);
	padding: 0 8px 13px;
}
.section-label span {
	letter-spacing: 0;
}
.search {
	display: flex;
	align-items: center;
	gap: 7px;
	border: 1px solid var(--line);
	border-radius: 9px;
	padding: 8px 11px;
	margin: 0 0 14px;
}
.search input {
	min-width: 0;
	width: 100%;
	background: none;
	border: 0;
	outline: none;
	color: var(--ink);
	font-size: 12px;
}
.search span {
	font-size: 20px;
	color: var(--muted);
}
.material {
	display: flex;
	align-items: center;
	gap: 10px;
	text-align: left;
	width: 100%;
	padding: 11px 9px;
	margin-bottom: 3px;
	border: 1px solid transparent;
	border-radius: 10px;
	background: transparent;
	color: var(--ink);
}
.material:hover,
.draft-link:hover {
	background: color-mix(in srgb, var(--green) 5%, transparent);
}
.material.chosen,
.draft-link.chosen {
	border-color: color-mix(in srgb, var(--green) 20%, transparent);
	background: color-mix(in srgb, var(--green) 8%, transparent);
}
.material-icon {
	font-size: 19px;
	color: var(--muted);
}
.material > span:nth-child(2) {
	min-width: 0;
	flex: 1;
}
.material strong {
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 12px;
	font-weight: 550;
}
.material small {
	display: block;
	color: var(--muted);
	margin-top: 3px;
}
.chevron {
	color: var(--muted);
}
.shelf-empty {
	padding: 10px;
	font-size: 12px;
}
.library-label {
	margin-top: 26px;
}
.draft-link {
	display: flex;
	align-items: center;
	gap: 9px;
	padding: 10px 9px;
	border: 1px solid transparent;
	background: transparent;
	border-radius: 9px;
	width: 100%;
	text-align: left;
	color: var(--ink);
}
.draft-link span:nth-child(2) {
	flex: 1;
	font-size: 12px;
}
.draft-link small {
	font-size: 9px;
	color: var(--muted);
}
.lookup {
	margin: 15px 8px;
	font-size: 11px;
	color: var(--muted);
}
.lookup form {
	display: flex;
	gap: 4px;
	margin-top: 10px;
}
.lookup input {
	width: 120px;
}
.lookup p {
	margin-top: 8px;
}
.canvas {
	flex: 1;
	min-width: 0;
	overflow: auto;
	padding: 30px clamp(20px, 4vw, 58px) 45px;
}
.canvas-heading {
	margin-bottom: 30px;
}
.eyebrow {
	display: block;
	color: var(--muted);
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: 1.6px;
	margin-bottom: 8px;
}
.canvas-heading p {
	margin-top: 8px;
}
.primary,
.secondary,
.quiet,
.chip {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 9px;
	padding: 9px 14px;
	border-radius: 9px;
	white-space: nowrap;
	font-size: 12px !important;
}
.primary {
	background: var(--green);
	color: var(--color-primary-foreground, #fff);
	border: 1px solid var(--green);
}
.primary:hover {
	filter: brightness(1.08);
}
.secondary {
	border: 1px solid var(--line);
	background: var(--paper);
	color: var(--ink);
}
.secondary:hover,
.quiet:hover,
.chip:hover {
	background: color-mix(in srgb, var(--green) 7%, transparent);
}
.quiet {
	border: 0;
	color: var(--muted);
	background: transparent;
	padding: 7px 9px;
}
.chip {
	border: 1px solid var(--line);
	border-radius: 20px;
	background: transparent;
	color: var(--ink);
	font-size: 11px !important;
	padding: 6px 11px;
}
.start-card {
	text-align: center;
	border: 1px dashed color-mix(in srgb, var(--green) 25%, transparent);
	border-radius: 18px;
	background: color-mix(in srgb, var(--green) 3%, transparent);
	padding: 50px 24px;
	margin-top: 15px;
}
.start-card p {
	max-width: 350px;
	margin: 12px auto 23px;
}
.start-card > small {
	display: block;
	margin-top: 13px;
	color: var(--muted);
}
.start-card.compact {
	padding: 32px 24px;
}
.orbit {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 18px;
	margin: 5px 0 28px;
}
.orbit span {
	width: 62px;
	height: 62px;
	border: 1px solid var(--line);
	background: var(--paper);
	border-radius: 17px;
	display: grid;
	place-items: center;
	font-size: 30px;
	color: var(--green);
	box-shadow: 0 6px 18px #233b3307;
}
.orbit b {
	font-weight: 400;
	color: var(--muted);
}
.subject-card {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 17px;
	border: 1px solid var(--line);
	border-radius: 12px;
}
.subject-card > div {
	flex: 1;
	min-width: 0;
	overflow-wrap: anywhere;
}
.subject-icon {
	font-size: 27px;
	color: var(--green);
}
.subject-card p {
	font-size: 11px;
	margin-top: 4px;
}
.opportunities {
	display: grid;
	gap: 13px;
	margin-top: 24px;
}
.opportunity {
	display: flex;
	text-align: left;
	align-items: flex-start;
	gap: 20px;
	padding: 23px;
	border: 1px solid var(--line);
	border-radius: 13px;
	background: var(--paper);
	color: var(--ink);
}
.opportunity:hover {
	border-color: color-mix(in srgb, var(--green) 45%, transparent);
	transform: translateY(-1px);
	box-shadow: 0 6px 22px #143d2907;
}
.opportunity-index {
	color: var(--muted);
	font-size: 11px;
	margin-top: 3px;
}
.opportunity > div {
	flex: 1;
}
.opportunity h3 {
	font-size: 18px;
	margin-bottom: 10px;
}
.mini-route {
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
	margin: 6px 0 12px;
}
.mini-route span {
	font-size: 10px;
	border: 1px solid var(--line);
	padding: 4px 8px;
	border-radius: 5px;
	color: var(--muted);
}
.mini-route span + span:before {
	content: "→";
	margin-right: 7px;
}
.opportunity small {
	color: var(--green);
}
.opportunity small.conditional {
	color: #977244;
}
.arrow {
	font-size: 21px;
	color: var(--green);
}
.footnote {
	color: var(--muted);
	font-size: 11px;
	margin-top: 20px !important;
	line-height: 1.6;
}
.compose-head {
	display: flex;
	align-items: center;
	gap: 15px;
	margin-bottom: 28px;
}
.compose-head > div {
	flex: 1;
	min-width: 0;
}
.program-name {
	font-size: 26px !important;
	letter-spacing: -0.8px;
	background: none;
	border: 0;
	width: 100%;
	padding: 0;
	color: var(--ink);
	margin-bottom: 5px;
}
.program-flow {
	max-width: 740px;
	margin: auto;
}
.studio-flow-card {
	display: flex;
	align-items: flex-start;
	gap: 15px;
	border: 1px solid var(--line);
	background: var(--paper);
	border-radius: 13px;
	padding: 18px 20px;
}
.studio-flow-card.open-goal {
	border: 1px dashed color-mix(in srgb, var(--green) 50%, transparent);
	background: color-mix(in srgb, var(--green) 3%, transparent);
}
.node-icon {
	display: grid;
	place-items: center;
	flex-shrink: 0;
	width: 31px;
	height: 31px;
	background: color-mix(in srgb, var(--green) 8%, transparent);
	color: var(--green);
	border-radius: 9px;
	font-size: 21px;
	margin-top: 3px;
}
.node-body {
	flex: 1;
	min-width: 0;
}
.binding {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin-top: 7px;
}
.binding small {
	margin-left: 6px;
	color: var(--muted);
}
.studio select,
.studio textarea,
.binding input,
.lookup input,
.what-if input {
	border: 1px solid var(--line);
	background: var(--paper);
	border-radius: 7px;
	padding: 8px 10px;
	color: var(--ink);
	max-width: 100%;
	min-width: 0;
}
.binding select {
	width: 100%;
}
.step-name {
	border: 0;
	background: none;
	font-weight: 600 !important;
	font-size: 15px !important;
	color: var(--ink);
	padding: 0;
	width: 100%;
}
.studio-flow-line {
	height: 22px;
	width: 1px;
	background: var(--line);
	margin-left: 35px;
}
.output-card {
	background: color-mix(in srgb, var(--green) 7%, transparent);
}
.output-card p {
	font-size: 11px;
	margin-top: 5px;
}
.step-details {
	color: var(--muted);
	font-size: 11px;
}
.step-details p {
	margin-top: 8px;
	overflow-wrap: anywhere;
}
.extend {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
	margin: 18px 0 24px;
	font-size: 11px;
}
.policy-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 10px;
	padding: 18px 0;
	border-top: 1px solid var(--line);
	font-size: 11px;
}
.toggle {
	display: flex;
	align-items: center;
	gap: 8px;
}
.toggle input {
	accent-color: var(--green);
	width: 15px;
	height: 15px;
}
.plan-status {
	display: flex;
	justify-content: space-between;
	gap: 10px;
	padding: 13px 15px;
	border-radius: 9px;
	background: color-mix(in srgb, var(--green) 7%, transparent);
	color: var(--green);
	font-size: 12px;
}
.plan-status small {
	color: var(--muted);
}
.studio summary {
	cursor: pointer;
}
.what-if {
	margin-top: 17px;
	border: 1px solid var(--line);
	border-radius: 10px;
	padding: 14px;
}
.what-if > summary {
	display: flex;
	justify-content: space-between;
}
.what-if small {
	color: var(--muted);
}
.what-if-body {
	display: flex;
	gap: 15px;
	align-items: center;
	margin-top: 17px;
	flex-wrap: wrap;
}
.what-if input {
	width: 60px;
	margin-left: 8px;
}
.comparison {
	display: flex;
	align-items: center;
	gap: 30px;
	margin-top: 17px;
	padding-top: 15px;
	border-top: 1px solid var(--line);
}
.comparison strong,
.comparison small {
	display: block;
}
.comparison strong {
	margin-top: 4px;
}
.advanced {
	margin-top: 18px;
	font-size: 11px;
	color: var(--muted);
}
.advanced textarea {
	font-family: monospace !important;
	width: 100%;
	min-height: 250px;
	margin: 12px 0;
	font-size: 11px !important;
	resize: vertical;
}
.compose-actions {
	position: sticky;
	bottom: 0;
	z-index: 2;
	padding: 14px 0;
	background: var(--paper);
	border-top: 1px solid var(--line);
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 25px;
	flex-wrap: wrap;
}
.compose-actions > span {
	flex: 1;
}
.message {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 12px 20px;
	font-size: 12px;
	overflow-wrap: anywhere;
}
.message button {
	background: transparent;
	border: 1px solid currentColor;
	border-radius: 6px;
	padding: 4px 8px;
	white-space: nowrap;
	color: inherit;
}
.warning {
	background: #bd8a1410;
	color: #98712b;
}
.success {
	background: #338a6410;
	color: var(--green);
}
.canvas .message {
	border-radius: 9px;
	margin: 12px 0;
}
.connection-editor {
	display: grid;
	gap: 15px;
	padding: 24px;
	border: 1px solid var(--line);
	border-radius: 13px;
	margin-top: 18px;
}
.connection-editor label {
	display: grid;
	grid-template-columns: 90px 1fr;
	align-items: center;
	gap: 12px;
}
.connection-editor p {
	font-size: 12px;
}
.connection-editor button {
	justify-self: end;
}
.empty-symbol {
	font-size: 50px;
	color: var(--green);
	margin-bottom: 20px;
}
.connection {
	display: flex;
	align-items: center;
	gap: 13px;
	padding: 20px 12px;
	border-bottom: 1px solid var(--line);
}
.connection > div {
	flex: 1;
}
.connection-dot {
	width: 8px;
	height: 8px;
	flex-shrink: 0;
}
.connection-dot.paused {
	background: var(--muted);
}
.connection p {
	font-size: 11px;
	margin-top: 5px;
}
.error-text {
	color: #9c5f3a;
}
.empty-row {
	display: flex;
	align-items: center;
	gap: 16px;
	padding: 22px 10px;
	color: var(--muted);
	font-size: 12px;
	border-top: 1px solid var(--line);
}
.empty-row > span {
	font-size: 27px;
}
.empty-row p {
	flex: 1;
	line-height: 1.7;
}
.activity-label {
	margin-top: 35px;
}
.run-card {
	border: 1px solid var(--line);
	padding: 20px;
	border-radius: 13px;
	margin-bottom: 14px;
}
.run-top {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 14px;
}
.run-top small {
	color: var(--muted);
}
.run-state {
	font-size: 11px;
	color: var(--green);
	text-transform: capitalize;
}
.run-state.failed {
	color: #9c5f3a;
}
.run-card > p {
	line-height: 1.7;
	margin: 10px 0;
	font-size: 12px;
}
.result-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
	margin-top: 15px;
}
.result-status {
	flex: 1;
	color: var(--muted);
	font-size: 10px;
}
.run-card details {
	font-size: 11px;
	color: var(--muted);
	margin-top: 13px;
}
.studio pre {
	font: 11px / 1.6 monospace;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	max-height: 550px;
	overflow: auto;
	background: color-mix(in srgb, var(--green) 4%, transparent);
	padding: 15px;
	border-radius: 9px;
	margin: 12px 0;
}
.inspector::backdrop {
	background: #13281e35;
	backdrop-filter: blur(3px);
}
.inspector {
	margin: 0 0 0 auto;
	height: 100dvh;
	max-height: 100dvh;
	max-width: 100vw;
	border: 0;
	color: var(--ink);
	background: var(--paper);
	width: min(620px, 100%);
	padding: 30px;
	overflow: auto;
	box-shadow: -8px 0 40px #13281e12;
}
.inspector header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 15px;
}
.inspector h2 {
	font-size: 22px;
}
.provenance-links {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	margin-top: 15px;
}
@media (max-width: 1000px) {
	.shelf {
		width: 205px;
	}
	.studio-head {
		padding: 20px;
	}
	.tabs {
		padding-left: 20px;
		padding-right: 20px;
	}
	.tab-hint,
	.session {
		display: none;
	}
	.canvas {
		padding: 25px 22px;
	}
	.policy-row {
		align-items: flex-start;
		flex-direction: column;
	}
	.compose-actions {
		gap: 8px;
	}
	.compose-actions > span {
		display: none;
	}
}
@media (max-width: 700px) {
	.compose-actions {
		bottom: 52px;
	}
	.studio-head {
		align-items: flex-start;
		gap: 8px;
		padding: 17px;
	}
	.brand p {
		display: none;
	}
	.brand-mark {
		width: 34px;
		height: 34px;
		font-size: 25px;
	}
	.brand {
		gap: 9px;
	}
	.studio h1 {
		font-size: 16px;
	}
	.header-actions {
		gap: 3px;
	}
	.header-actions .secondary {
		padding: 7px;
		font-size: 10px !important;
	}
	.workspace {
		flex-direction: column;
		overflow: auto;
	}
	.shelf {
		width: auto;
		max-height: 195px;
		border-right: 0;
		border-bottom: 1px solid var(--line);
		padding: 13px;
		flex-shrink: 0;
	}
	.shelf-items {
		display: flex;
		gap: 7px;
		overflow-x: auto;
	}
	.material {
		min-width: 170px;
		max-width: 220px;
	}
	.shelf .section-label,
	.lookup,
	.library-label {
		display: none;
	}
	.search {
		margin-bottom: 8px;
	}
	.canvas {
		overflow: visible;
		padding: 24px 17px;
	}
	.studio h2 {
		font-size: 24px;
	}
	.studio-flow-card {
		padding: 15px 12px;
		gap: 10px;
	}
	.studio-flow-card > .quiet {
		font-size: 10px !important;
		padding: 4px;
	}
	.opportunity {
		padding: 20px 14px;
		gap: 12px;
	}
	.compose-head {
		align-items: flex-start;
	}
	.program-name {
		font-size: 21px !important;
	}
	.compose-head > .secondary {
		padding: 7px;
		font-size: 10px !important;
	}
	.plan-status {
		flex-direction: column;
		gap: 5px;
	}
	.tabs {
		padding: 0 15px 12px;
	}
	.tabs button {
		padding: 8px 10px;
	}
	.what-if > summary small {
		font-size: 9px;
	}
	.connection {
		gap: 8px;
		flex-wrap: wrap;
	}
	.connection .quiet {
		display: none;
	}
	.orbit {
		gap: 12px;
	}
	.orbit span {
		width: 52px;
		height: 52px;
	}
	.start-card {
		padding: 35px 15px;
	}
	.inspector {
		padding: 22px;
	}
}
@media (prefers-reduced-motion: reduce) {
	.studio button {
		transition: none;
	}
	.opportunity:hover {
		transform: none;
	}
}
</style>
