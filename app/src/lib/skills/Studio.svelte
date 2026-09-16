<script lang="ts">
import {
	composeSkillArtifact,
	editStudioSkillV2,
	newStudioSkillV2,
	type PlanRunRecord,
	parseStudioSkillV2,
	type StudioCatalogEntry,
	type StudioSkillPort,
	type StudioSkillV2
} from '@avenos/actors'
import { onMount } from 'svelte'
import StudioOperations from './StudioOperations.svelte'
import {
	refreshStudio,
	type StudioArtifact,
	type StudioConnection,
	type StudioDraft,
	type StudioExploration,
	type StudioPreview,
	studio,
	studioName,
	studioRequest,
	synchronizeStudio
} from './studio.svelte'
import { composeAuthorizedStudioOperation } from './studio-compose'

let tab = $state<'explore' | 'compose' | 'activity'>('explore')
let busy = $state(false)
let error = $state('')
let notice = $state('')
let search = $state('')
let selected = $state<StudioArtifact | null>(null)
let exploration = $state<StudioExploration | null>(null)
let draft = $state<StudioDraft | null>(null)
let definition = $state<StudioSkillV2 | null>(null)
let preview = $state<StudioPreview | null>(null)
let bindings = $state<Record<string, string>>({})
let parameters = $state<Record<string, unknown>>({})
let showOperations = $state(false)
let raw = $state('')
let inspector = $state<Record<string, any> | null>(null)
let inspectorDialog: HTMLDialogElement | undefined = $state()
let showConnection = $state(false)
let watchPort = $state('')
let sourceFilter = $state('')
let openedPublishedSkillId = $state<string | null>(null)
let workspaceKey = ''
let pendingSample: { requestId: string; observedAt: string } | null = null

const snapshot = $derived(studio.snapshot)
const artifacts = $derived(
	(snapshot?.artifacts ?? []).filter((artifact) =>
		`${studioName(artifact)} ${artifact.typeKey}`.toLowerCase().includes(search.toLowerCase())
	)
)
const savedSkills = $derived(
	(snapshot?.skills ?? []).flatMap((artifact) => {
		if (artifact.typeVersion !== 2) return []
		try {
			return [{ artifact, definition: parseStudioSkillV2($state.snapshot(artifact.payload)) }]
		} catch {
			return []
		}
	})
)
const dirty = $derived(
	!!definition && JSON.stringify(definition) !== JSON.stringify(draft?.definition)
)
const conflict = $derived(
	!!draft &&
		!!snapshot?.drafts.some((item) => item.id === draft!.id && item.revision !== draft!.revision)
)
const publishedArtifactId = $derived(
	!dirty && openedPublishedSkillId
		? openedPublishedSkillId
		: !dirty && draft?.publishedRevision === draft?.revision
			? (draft?.publishedArtifactId ?? null)
			: null
)
const inputNames = $derived(Object.keys(definition?.inputs ?? {}))
const requiredParameters = $derived(
	(definition?.parametersSchema.required as string[] | undefined) ?? []
)
const parameterSchemas = $derived(
	(definition?.parametersSchema.properties as
		| Record<string, Record<string, unknown>>
		| undefined) ?? {}
)

async function act(work: () => Promise<void>) {
	if (busy) return
	busy = true
	error = ''
	notice = ''
	try {
		await work()
	} catch (cause) {
		error = cause instanceof Error ? cause.message : String(cause)
	} finally {
		busy = false
	}
}

function fresh(next: StudioSkillV2) {
	openedPublishedSkillId = null
	const exact = parseStudioSkillV2($state.snapshot(next))
	definition = exact
	draft = {
		id: crypto.randomUUID(),
		subjectId: snapshot?.subjectId ?? '',
		revision: 0,
		definition: structuredClone(exact),
		publishedArtifactId: null,
		publishedRevision: null,
		updatedAt: new Date().toISOString()
	}
	bindings = {}
	parameters = {}
	raw = JSON.stringify(next, null, 2)
	tab = 'compose'
}

function createBlank() {
	fresh(newStudioSkillV2('Untitled Skill'))
	showOperations = true
}
function openDraft(value: StudioDraft) {
	openedPublishedSkillId = null
	draft = structuredClone($state.snapshot(value))
	definition = parseStudioSkillV2($state.snapshot(value.definition))
	bindings = {}
	parameters = {}
	raw = JSON.stringify(value.definition, null, 2)
	tab = 'compose'
}
async function openSkill(artifact: StudioArtifact, action: 'open' | 'use' | 'prepare' = 'open') {
	if (artifact.typeKey !== 'studio.skill' || artifact.typeVersion !== 2)
		throw new Error('This exact Skill version is unavailable in the current runtime.')
	const exact = parseStudioSkillV2($state.snapshot(artifact.payload))
	if (action === 'use') {
		fresh(newStudioSkillV2(`${exact.name} workflow`))
		addChild(artifact, exact)
	} else {
		fresh(exact)
		openedPublishedSkillId = artifact.artifactId
		notice =
			action === 'prepare'
				? 'Select inputs to run this exact Skill.'
				: 'Viewing the exact saved Skill. Editing creates a new draft.'
	}
	selected = artifact
}
async function explore(artifact: StudioArtifact) {
	selected = artifact
	exploration = await studioRequest<StudioExploration>('explore', {
		artifactId: artifact.artifactId
	})
	tab = 'explore'
}
async function addOperation(entry: StudioCatalogEntry) {
	if (!definition) fresh(newStudioSkillV2('Untitled Skill'))
	const result = await composeAuthorizedStudioOperation(
		$state.snapshot(definition!),
		entry.capabilityId,
		studioRequest
	)
	definition = result.definition
	showOperations = false
	tab = 'compose'
	notice = result.cues.some((cue) => cue.kind === 'new-input')
		? `${entry.label} added · one input is needed.`
		: `${entry.label} added and connected.`
}
function addChild(artifact: StudioArtifact, child: StudioSkillV2) {
	if (!definition) return
	definition = composeSkillArtifact(
		$state.snapshot(definition),
		artifact.artifactId,
		$state.snapshot(child)
	).definition
	notice = `${child.name} nested as an exact reusable Skill.`
}
function rename(value: string) {
	if (definition && value.trim())
		definition = editStudioSkillV2($state.snapshot(definition), {
			kind: 'rename',
			name: value.trim()
		}).definition
}
function labelStep(stepId: string, value: string) {
	if (definition && value.trim())
		definition = editStudioSkillV2($state.snapshot(definition), {
			kind: 'set-step-label',
			stepId,
			label: value.trim()
		}).definition
}
function addGoal() {
	if (!definition) return
	const first = Object.keys(definition.inputs)[0]
	definition.steps.push({
		id: `goal-${crypto.randomUUID().slice(0, 7)}`,
		kind: 'achieve',
		label: 'Find a route',
		goals: ['Describe the desired fact'],
		ingredients: first ? [{ kind: 'input', port: first }] : [],
		factFamilies: [],
		excludedCapabilityIds: [],
		outputs: {}
	})
	definition = parseStudioSkillV2($state.snapshot(definition))
	notice = 'Open goal added for the solver.'
}
function addReview() {
	if (!definition) return
	const first = Object.entries(definition.inputs)[0]
	if (!first) {
		error = 'Add an operation with an input first.'
		return
	}
	definition.steps.push({
		id: `review-${crypto.randomUUID().slice(0, 7)}`,
		kind: 'review',
		label: 'Human review',
		subjectSchema: first[1].schema,
		subjects: { subject: { kind: 'input', port: first[0] } },
		outputs: {}
	})
	definition = parseStudioSkillV2($state.snapshot(definition))
	notice = 'Review gate added.'
}
async function save() {
	if (!definition || !draft || (draft.revision > 0 && !dirty)) return
	draft = await studioRequest<StudioDraft>('draft', {
		id: draft.id,
		revision: draft.revision,
		definition: $state.snapshot(definition)
	})
	await refreshStudio()
	openedPublishedSkillId = null
	notice = 'Draft saved everywhere.'
}
async function publishSkill() {
	if (!definition) return
	if (!draft) {
		draft = {
			id: crypto.randomUUID(),
			subjectId: snapshot?.subjectId ?? '',
			revision: 0,
			definition: structuredClone($state.snapshot(definition)),
			publishedArtifactId: null,
			publishedRevision: null,
			updatedAt: new Date().toISOString()
		}
	}
	await save()
	if (!draft) return
	const result = await studioRequest<{ draft: StudioDraft; artifact: StudioArtifact }>('publish', {
		id: draft.id,
		revision: draft.revision
	})
	draft = result.draft
	await refreshStudio()
	notice = 'Immutable Skill published.'
}
function parameterReady() {
	return requiredParameters.every((name) => Object.hasOwn(parameters, name))
}
async function run() {
	if (!publishedArtifactId) return
	await studioRequest('start', {
		requestId: crypto.randomUUID(),
		skillArtifactId: publishedArtifactId,
		inputs: $state.snapshot(bindings),
		parameters: $state.snapshot(parameters)
	})
	tab = 'activity'
	await refreshStudio()
	notice = 'Run accepted · provenance will be retained.'
}
async function sample() {
	pendingSample ??= { requestId: crypto.randomUUID(), observedAt: new Date().toISOString() }
	const result = await studioRequest<{ artifacts: StudioArtifact[] }>('sample', pendingSample)
	pendingSample = null
	await refreshStudio()
	const email = result.artifacts.find((artifact) => artifact.typeKey === 'studio.email')
	if (email) await explore(email)
}
async function inspect(artifactId: string) {
	inspector = await studioRequest('inspect', { artifactId })
}
async function connect() {
	if (!publishedArtifactId || !definition || !watchPort) return
	await studioRequest('connect', {
		id: crypto.randomUUID(),
		name: definition.name,
		skillArtifactId: publishedArtifactId,
		sourceArtifactId: sourceFilter || null,
		inputPort: watchPort,
		fixedInputs: Object.fromEntries(
			Object.entries(bindings).filter(([name]) => name !== watchPort)
		),
		parameters: $state.snapshot(parameters),
		enabled: true
	})
	showConnection = false
	tab = 'activity'
	await refreshStudio()
	notice = 'Connection enabled.'
}
async function control(connection: StudioConnection) {
	await studioRequest('control', {
		id: connection.id,
		revision: connection.revision,
		enabled: !connection.enabled
	})
	await refreshStudio()
}
const compatible = (artifact: StudioArtifact, port: StudioSkillPort) =>
	artifact.typeKey === port.type.key && artifact.typeVersion === port.type.version
const candidates = (port: StudioSkillPort) =>
	(snapshot?.artifacts ?? []).filter((artifact) => compatible(artifact, port))
const readableType = (key: string) =>
	(
		({
			'studio.email': 'Email',
			'studio.brief': 'Brief',
			'studio.skill': 'Skill',
			'core.file': 'File'
		}) as Record<string, string>
	)[key] ?? key
const runArtifact = (run: PlanRunRecord): StudioArtifact | null =>
	(run.checkpoints.at(-1)?.output as { artifact?: StudioArtifact } | undefined)?.artifact ?? null

$effect(() => {
	if (inspector && inspectorDialog && !inspectorDialog.open) inspectorDialog.showModal()
})
$effect(() => {
	const key = snapshot ? `${snapshot.scopeId}/${snapshot.subjectId}` : ''
	if (!key || key === workspaceKey) return
	if (workspaceKey) {
		openedPublishedSkillId = null
		selected = null
		exploration = null
		draft = null
		definition = null
		bindings = {}
		parameters = {}
		tab = 'explore'
	}
	workspaceKey = key
})
$effect(() => {
	const id = studio.requestedSkillId
	if (id) {
		const action = studio.requestedSkillAction
		studio.requestedSkillId = null
		void act(async () => {
			const result = await studioRequest<{ artifact: StudioArtifact }>('inspect', {
				artifactId: id
			})
			await openSkill(result.artifact, action)
		})
	}
})
$effect(() => {
	const serialized = definition ? JSON.stringify(definition) : ''
	preview = null
	if (!serialized) return
	let cancelled = false
	const timer = setTimeout(
		() =>
			void studioRequest<StudioPreview>('preview', { definition: JSON.parse(serialized) })
				.then((value) => {
					if (!cancelled) preview = value
				})
				.catch((cause) => {
					if (!cancelled) error = String(cause)
				}),
		220
	)
	return () => {
		cancelled = true
		clearTimeout(timer)
	}
})
$effect(() => {
	studio.refreshVersion
	void refreshStudio().catch((cause) => {
		error = String(cause)
	})
})
onMount(() => {
	const tick = () => {
		if (!busy && document.visibilityState === 'visible')
			void synchronizeStudio().catch((cause) => {
				error = String(cause)
			})
	}
	tick()
	const timer = setInterval(tick, 7000)
	return () => clearInterval(timer)
})
</script>

<section class="studio" aria-label="Skill Studio">
	<header class="topbar">
		<div class="brand">
			<span>✳</span>
			<div>
				<h1>Skill Studio</h1>
				<p>From what you have to what you need.</p>
			</div>
		</div>
		<div class="top-actions">
			<span class="live"><i></i> Shared workspace</span
			><button class="secondary" onclick={() => showOperations = true}>◈ Operations</button
			><button class="secondary" disabled={busy} onclick={() => void act(sample)}>
				＋ Sample email
			</button><button
				class="icon"
				aria-label="Refresh"
				onclick={() => void act(async () => { await refreshStudio() })}
			>
				↻
			</button>
		</div>
	</header>
	<nav class="tabs" aria-label="Studio views">
		{#each [{ id: 'explore', label: 'Explore', icon: '◈' }, { id: 'compose', label: 'Compose', icon: '⌘' }, { id: 'activity', label: 'Activity', icon: '↗' }] as item}
			<button
				class:active={tab === item.id}
				aria-current={tab === item.id ? 'page' : undefined}
				onclick={() => tab = item.id as typeof tab}
			>
				<span>{item.icon}</span>{item.label}
			</button>
		{/each}
		<small>{busy ? 'Working…' : 'Every result keeps its history'}</small>
	</nav>
	{#if error}
		<div class="banner error" role="alert">
			<span>! {error}</span><button onclick={() => error = ''}>Dismiss</button>
		</div>
	{/if}
	{#if notice}
		<div class="banner success" role="status">✓ {notice}</div>
	{/if}

	<div class="workspace">
		<aside class="rail">
			<div class="rail-title">
				<span>Artifacts</span><small>{snapshot?.artifacts.length ?? '—'}</small>
			</div>
			<label class="search"
				><span>⌕</span>
				<input bind:value={search} placeholder="Find anything" aria-label="Find artifact"></label
			>
			<div class="artifact-list">
				{#each artifacts as artifact (artifact.artifactId)}
					<button
						class:chosen={selected?.artifactId === artifact.artifactId}
						onclick={() => void act(() => explore(artifact))}
					>
						<b
							>{artifact.typeKey === 'studio.email' ? '✉' : artifact.typeKey === 'studio.skill' ? '⌘' : '▤'}</b
						><span
							><strong>{studioName(artifact)}</strong
							><small>{readableType(artifact.typeKey)}</small></span
						><i>›</i>
					</button>
				{:else}
					<p class="empty">Capture a sample email to begin.</p>
				{/each}
			</div>
			<div class="rail-title programs">
				<span>Programs</span><small>{snapshot?.drafts.length ?? 0}</small>
			</div>
			<button class="new-skill" onclick={createBlank}>＋ New Skill</button>
			{#each snapshot?.drafts ?? [] as item (item.id)}
				<button class="draft" class:chosen={draft?.id === item.id} onclick={() => openDraft(item)}>
					<span>{item.publishedRevision === item.revision ? '◆' : '◇'}</span
					><b>{item.definition.name}</b
					><small>{item.publishedRevision === item.revision ? 'Published' : 'Draft'}</small>
				</button>
			{/each}
		</aside>

		<main class="canvas">
			{#if tab === 'explore'}
				<div class="heading">
					<span>01 / Possibilities</span>
					<h2>{selected ? 'What could this become?' : 'Start with something real.'}</h2>
					<p>{selected ? studioName(selected) : 'Choose an artifact or try the sample.'}</p>
				</div>
				{#if !selected}
					<div class="hero">
						<div class="orbit"><span>✉</span><i>→</i><span>⌘</span><i>→</i><span>◇</span></div>
						<h3>Small pieces. Useful programs.</h3>
						<p>Explore an artifact, choose an outcome, and let the Studio wire the named ports.</p>
						<button class="primary" onclick={() => void act(sample)}>Try a sample email ↗</button
						><small>No mailbox or model required.</small>
					</div>
				{:else}
					<div class="subject">
						<span>{selected.typeKey === 'studio.email' ? '✉' : '▤'}</span>
						<div>
							<b>{studioName(selected)}</b
							><small>{readableType(selected.typeKey)} · committed</small>
						</div>
						<button class="quiet" onclick={() => void act(() => inspect(selected!.artifactId))}>
							Trace ↗
						</button>
					</div>
					<div class="opportunities">
						{#each exploration?.opportunities ?? [] as opportunity, index}
							<button
								onclick={() => { fresh(opportunity.definition); const port = Object.keys(opportunity.definition.inputs)[0]; if (port) bindings[port] = selected!.artifactId }}
							>
								<span>0{index + 1}</span>
								<div>
									<h3>{opportunity.label}</h3>
									<p>{opportunity.steps.map((step) => step.label).join(' → ')}</p>
									<small>✓ Installed and authorable</small>
								</div>
								<b>↗</b>
							</button>
						{:else}
							<div class="hero compact">
								<h3>No direct route yet.</h3>
								<p>A new installed Actor can extend this space without a Studio edit.</p>
								{#if selected.typeKey === 'studio.skill' && selected.typeVersion === 2}
									<button class="primary" onclick={() => void act(() => openSkill(selected!))}>
										Open Skill ↗
									</button>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			{:else if tab === 'compose'}
				{#if definition}
					<div class="compose-head">
						<div>
							<span>02 / Composition</span>
							<input
								class="title-input"
								aria-label="Skill name"
								value={definition.name}
								onblur={(event) => rename(event.currentTarget.value)}
							>
						</div>
						<div class="status" class:ready={preview?.ok}>
							{preview?.ok ? '✓ Ready to publish' : preview ? '◌ Needs attention' : '◌ Checking'}
						</div>
					</div>
					<div class="flow">
						<div class="boundary">
							<span>Inputs</span>
							{#each Object.entries(definition.inputs) as [name, port]}
								<div>
									<b>IN</b><strong>{name}</strong
									><small>{readableType(port.type.key)} · {port.cardinality}</small>
								</div>
							{/each}
						</div>
						<div class="line"></div>
						<div class="steps">
							{#each definition.steps as step, index (step.id)}
								<article>
									<span class="number">{String(index + 1).padStart(2, '0')}</span
									><span class="kind"
										>{step.kind === 'invoke' ? '◇' : step.kind === 'skill' ? '⌘' : step.kind === 'review' ? '✓' : '◈'}</span
									>
									<div>
										<input
											aria-label="Step label"
											value={step.label}
											onblur={(event) => labelStep(step.id, event.currentTarget.value)}
										><small
											>{step.kind === 'invoke' ? step.capabilityId.split(':').at(-1) : step.kind === 'skill' ? 'Exact nested Skill' : step.kind}</small
										>
									</div>
								</article>
							{:else}
								<button class="drop" onclick={() => showOperations = true}>
									<b>＋</b><span>Add an operation</span><small>Ports connect themselves</small>
								</button>
							{/each}
						</div>
						<div class="line"></div>
						<div class="boundary outputs">
							<span>Outputs</span>
							{#each Object.entries(definition.outputs) as [name, port]}
								<div>
									<b>OUT</b><strong>{name}</strong><small>{readableType(port.type.key)}</small>
								</div>
							{/each}
						</div>
					</div>
					<div class="tool-row">
						<button onclick={() => showOperations = true}>＋ Operation</button
						><button
							title="Draft and inspect now; runtime support is not installed yet."
							onclick={addGoal}
						>
							◈ Open goal · draft
						</button><button
							title="Draft and inspect now; runtime support is not installed yet."
							onclick={addReview}
						>
							✓ Review · draft
						</button><span></span
						><button
							class:on={definition.policy.allowModel}
							onclick={() => definition!.policy.allowModel = !definition!.policy.allowModel}
						>
							✦ Model {definition.policy.allowModel ? 'allowed' : 'off'}
						</button>
					</div>
					{#if savedSkills.length}
						<section class="reuse">
							<header>
								<div>
									<b>Reusable Skills</b>
									<p>Exact immutable children, available everywhere.</p>
								</div>
							</header>
							<div>
								{#each savedSkills as saved}
									<button
										disabled={saved.artifact.artifactId === publishedArtifactId}
										onclick={() => addChild(saved.artifact, saved.definition)}
									>
										<span>⌘</span>
										<div>
											<b>{saved.definition.name}</b
											><small>{saved.definition.steps.length} steps · v2</small>
										</div>
										<i>＋</i>
									</button>
								{/each}
							</div>
						</section>
					{/if}
					<div class="run-form">
						<header>
							<div>
								<b>Run settings</b>
								<p>Only choices required by this Skill appear here.</p>
							</div>
							<small>{publishedArtifactId ? 'Published revision' : 'Publish first'}</small>
						</header>
						<div class="fields">
							{#each Object.entries(definition.inputs) as [name, port]}
								<label
									><span>{name}<small>{readableType(port.type.key)}</small></span
									><select
										aria-label={`Input ${name}`}
										value={bindings[name] ?? ''}
										onchange={(event) => bindings[name] = event.currentTarget.value}
									>
										<option value="">Choose an artifact…</option>
										{#each candidates(port) as candidate}
											<option value={candidate.artifactId}>{studioName(candidate)}</option>
										{/each}
									</select></label
								>
							{/each}
							{#each Object.entries(parameterSchemas) as [name, schema]}
								<label
									><span
										>{name}
										<small
											>{requiredParameters.includes(name) ? 'Required' : 'Optional'}</small
										></span
									>
									{#if Array.isArray(schema.enum)}
										<select
											aria-label={`Setting ${name}`}
											onchange={(event) => parameters[name] = event.currentTarget.value}
										>
											<option value="">Choose…</option>
											{#each schema.enum as choice}
												<option value={String(choice)}>{String(choice)}</option>
											{/each}
										</select>
									{:else if schema.type === 'boolean'}
										<input
											type="checkbox"
											aria-label={`Setting ${name}`}
											onchange={(event) => parameters[name] = event.currentTarget.checked}
										>
									{:else}
										<input
											aria-label={`Setting ${name}`}
											type={schema.type === 'integer' || schema.type === 'number' ? 'number' : 'text'}
											maxlength={Number(schema.maxLength ?? 1024)}
											oninput={(event) => parameters[name] = schema.type === 'integer' || schema.type === 'number' ? Number(event.currentTarget.value) : event.currentTarget.value}
										>
									{/if}</label
								>
							{/each}
						</div>
					</div>
					{#if preview && !preview.ok}
						<div class="issues" role="status">
							{#each preview.issues as issue}
								<p><b>◌</b><span>{issue.message}</span></p>
							{/each}
						</div>
					{/if}
					<details
						class="advanced"
						ontoggle={(event) => { if (event.currentTarget.open) raw = JSON.stringify($state.snapshot(definition), null, 2) }}
					>
						<summary>
							Inspect full definition <small>Agent-readable · closed v2 contract</small>
						</summary>
						<textarea bind:value={raw} aria-label="Skill definition JSON"></textarea
						><button
							onclick={() => { try { definition = parseStudioSkillV2(JSON.parse(raw)); error = '' } catch (cause) { error = String(cause) } }}
						>
							Apply inspected definition
						</button>
					</details>
					<div class="actions">
						<button
							class="quiet"
							disabled={!publishedArtifactId}
							onclick={() => { watchPort = inputNames[0] ?? ''; showConnection = !showConnection }}
						>
							Connect arrivals
						</button><span></span
						><button
							class="secondary"
							disabled={!preview?.ok || conflict}
							onclick={() => void act(async () => { await publishSkill() })}
						>
							{publishedArtifactId ? 'Publish new revision' : 'Publish Skill'}
						</button><button
							class="primary"
							disabled={!publishedArtifactId || inputNames.some((name) => !bindings[name]) || !parameterReady()}
							onclick={() => void act(run)}
						>
							Run Skill ↗
						</button>
					</div>
					{#if showConnection}
						<div class="connection-editor">
							<h3>When a matching artifact arrives…</h3>
							<label
								>Feed into<select bind:value={watchPort}>
									{#each inputNames as name}
										<option value={name}>{name}</option>
									{/each}
								</select></label
							><label
								>From<select bind:value={sourceFilter}>
									<option value="">Any source</option>
									{#each snapshot?.sources ?? [] as source}
										<option value={source.artifactId}>{studioName(source)}</option>
									{/each}
								</select></label
							>
							<p>Future artifacts only. The exact Skill and causal source are retained.</p>
							<button class="primary" onclick={() => void act(connect)}>Enable connection ↗</button>
						</div>
					{/if}
				{:else}
					<div class="hero">
						<div class="symbol">⌘</div>
						<h3>Compose without a blank page.</h3>
						<p>Pick an artifact or start with an operation.</p>
						<button class="primary" onclick={createBlank}>New Skill ↗</button>
					</div>
				{/if}
			{:else}
				<div class="heading">
					<span>03 / In motion</span>
					<h2>Connected work.</h2>
					<p>Durable rules, visible outputs, complete provenance.</p>
				</div>
				<section class="activity">
					<h3>Connections <small>{snapshot?.connections.length ?? 0}</small></h3>
					{#each snapshot?.connections ?? [] as connection (connection.id)}
						<article>
							<i class:paused={!connection.enabled}></i>
							<div>
								<b>{connection.record.name}</b>
								<p>{connection.enabled ? 'Watching' : 'Paused'} · exact Skill</p>
							</div>
							<button onclick={() => void act(() => control(connection))}>
								{connection.enabled ? 'Pause' : 'Resume'}
							</button>
						</article>
					{:else}
						<p class="empty">Publish a Skill, then connect it to arrivals.</p>
					{/each}
				</section>
				<section class="activity">
					<h3>Recent runs <small>{snapshot?.runs.length ?? 0}</small></h3>
					{#each snapshot?.runs ?? [] as run (run.runId)}
						{@const output = runArtifact(run)}
						<article>
							<span class="run-state" class:failed={run.state === 'failed'}
								>{run.state === 'succeeded' ? '✓' : run.state === 'failed' ? '!' : '◌'}</span
							>
							<div>
								<b>{output ? studioName(output) : 'Skill run'}</b>
								<p>
									{output ? String(output.payload.summary ?? 'Result committed.') : run.state.replaceAll('_', ' ')}
								</p>
							</div>
							{#if output}
								<button onclick={() => void act(() => inspect(output.artifactId))}>Trace ↗</button>
							{/if}
						</article>
					{:else}
						<p class="empty">Your first productive run will appear here.</p>
					{/each}
				</section>
			{/if}
		</main>
	</div>

	{#if inspector}
		<dialog
			bind:this={inspectorDialog}
			class="inspector"
			aria-label="Artifact provenance"
			onclose={() => inspector = null}
		>
			<header>
				<div>
					<span>Evidence, not a black box</span>
					<h2>Artifact & provenance</h2>
				</div>
				<button onclick={() => inspector = null}>✕</button>
			</header>
			<p>Immutable content and the exact inputs that produced it.</p>
			{#if Array.isArray(inspector.inputs)}
				<div class="links">
					{#each inspector.inputs as input}
						{#if typeof input.artifactId === 'string'}
							<button onclick={() => void act(() => inspect(input.artifactId))}>
								{input.role ?? 'Input'}
								↗
							</button>
						{/if}
					{/each}
				</div>
			{/if}
			<pre>{JSON.stringify(inspector, null, 2)}</pre>
		</dialog>
	{/if}
	<StudioOperations
		bind:open={showOperations}
		contextKey={snapshot ? `${snapshot.scopeId}/${snapshot.subjectId}` : ''}
		onchoose={(entry) => void act(() => addOperation(entry))}
	/>
</section>

<style>
:global(body) {
	--ink: var(--color-foreground, #233b33);
	--green: var(--color-primary, #2f6652);
	--paper: var(--color-surface, #f5f2e9);
}
.studio {
	min-height: 100%;
	background: var(--paper);
	color: var(--ink);
	font:
		13px / 1.4 Inter,
		system-ui,
		sans-serif;
}
button,
input,
select,
textarea {
	font: inherit;
}
button {
	color: inherit;
	cursor: pointer;
}
button:focus-visible,
input:focus-visible,
select:focus-visible,
summary:focus-visible,
textarea:focus-visible {
	outline: 2px solid var(--green);
	outline-offset: 2px;
}
.topbar {
	height: 78px;
	padding: 0 28px;
	display: flex;
	align-items: center;
	justify-content: space-between;
	border-bottom: 1px solid #233b3316;
	background: #fffdf8cc;
	backdrop-filter: blur(18px);
}
.brand,
.top-actions,
.brand > div,
.subject,
.compose-head,
.run-form header,
.reuse header,
.activity article,
.inspector header {
	display: flex;
	align-items: center;
}
.brand {
	gap: 12px;
}
.brand > span {
	width: 42px;
	height: 42px;
	display: grid;
	place-items: center;
	border-radius: 14px;
	color: var(--green);
	background: #2f665214;
	font-size: 23px;
}
.brand h1 {
	margin: 0;
	font-size: 18px;
}
.brand p {
	margin: 1px 0 0;
	color: #60746d;
	font-size: 11px;
}
.top-actions {
	gap: 8px;
}
.live {
	display: flex;
	align-items: center;
	gap: 7px;
	margin-right: 8px;
	color: #60746d;
	font-size: 11px;
}
.live i {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: #4fa576;
	box-shadow: 0 0 0 4px #4fa57618;
}
.secondary,
.quiet,
.icon,
.tool-row button,
.advanced button,
.activity button {
	border: 1px solid #233b3320;
	background: #fffdf8;
	border-radius: 9px;
	padding: 8px 12px;
}
.icon {
	width: 34px;
	padding: 8px;
}
.quiet {
	border-color: transparent;
	background: transparent;
}
.primary {
	border: 0;
	border-radius: 10px;
	padding: 10px 16px;
	background: var(--green);
	color: white;
	box-shadow: 0 7px 18px #244f4026;
}
.primary:disabled,
button:disabled {
	cursor: default;
	opacity: 0.42;
}
.tabs {
	height: 50px;
	padding: 0 28px;
	display: flex;
	align-items: stretch;
	gap: 4px;
	background: #fffdf8;
	border-bottom: 1px solid #233b3312;
}
.tabs button {
	border: 0;
	border-bottom: 2px solid transparent;
	padding: 0 16px;
	background: transparent;
	color: #64766f;
}
.tabs button span {
	margin-right: 7px;
}
.tabs button.active {
	color: var(--green);
	border-bottom-color: var(--green);
}
.tabs > small {
	margin: auto 0 auto auto;
	color: #86958f;
}
.banner {
	display: flex;
	justify-content: space-between;
	margin: 12px 28px 0;
	padding: 10px 14px;
	border-radius: 9px;
}
.banner.error {
	background: #b04b3d12;
	color: #863b31;
	border: 1px solid #b04b3d25;
}
.banner.success {
	background: #2f665210;
	color: #2f6652;
}
.banner button {
	border: 0;
	background: transparent;
}
.workspace {
	display: grid;
	grid-template-columns: 245px minmax(0, 1fr);
	min-height: calc(100vh - 128px);
}
.rail {
	padding: 22px 14px;
	border-right: 1px solid #233b3315;
	background: #ebe8de66;
}
.rail-title {
	display: flex;
	justify-content: space-between;
	padding: 0 8px 10px;
	color: #526760;
	font-size: 10px;
	letter-spacing: 1.2px;
	text-transform: uppercase;
}
.rail-title small {
	border-radius: 20px;
	background: #233b330d;
	padding: 1px 7px;
}
.rail-title.programs {
	margin-top: 24px;
}
.search {
	height: 35px;
	display: flex;
	align-items: center;
	gap: 7px;
	padding: 0 10px;
	border: 1px solid #233b3318;
	border-radius: 9px;
	background: #fffdf8;
}
.search input {
	min-width: 0;
	width: 100%;
	border: 0;
	outline: 0;
	background: transparent;
}
.artifact-list {
	max-height: 350px;
	overflow: auto;
	margin-top: 8px;
}
.artifact-list button,
.draft {
	width: 100%;
	display: grid;
	grid-template-columns: 25px minmax(0, 1fr) auto;
	align-items: center;
	gap: 7px;
	padding: 9px 8px;
	border: 0;
	border-radius: 9px;
	background: transparent;
	text-align: left;
}
.artifact-list button:hover,
.artifact-list button.chosen,
.draft:hover,
.draft.chosen {
	background: #fffdf8;
	box-shadow: 0 2px 8px #233b3308;
}
.artifact-list strong,
.draft b {
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 12px;
}
.artifact-list small,
.draft small {
	display: block;
	color: #82908b;
	font-size: 10px;
}
.artifact-list i {
	font-style: normal;
}
.new-skill {
	width: 100%;
	margin-bottom: 7px;
	padding: 9px;
	border: 1px dashed #2f66524a;
	border-radius: 9px;
	background: #2f665208;
	color: var(--green);
}
.empty {
	color: #81908a;
	padding: 14px 8px;
}
.canvas {
	padding: 34px clamp(24px, 5vw, 74px) 70px;
	overflow: hidden;
}
.heading > span,
.compose-head > div > span,
.inspector header span {
	color: var(--green);
	font-size: 10px;
	letter-spacing: 1.5px;
	text-transform: uppercase;
}
.heading h2 {
	margin: 6px 0 2px;
	font:
		500 clamp(27px, 3vw, 39px) / 1.1 Georgia,
		serif;
}
.heading p {
	margin: 0 0 30px;
	color: #71827c;
}
.hero {
	max-width: 540px;
	margin: 70px auto;
	padding: 44px;
	border: 1px solid #233b3315;
	border-radius: 22px;
	background: #fffdf8;
	box-shadow: 0 22px 60px #2b453b0c;
	text-align: center;
}
.hero.compact {
	margin: 20px 0;
}
.orbit {
	display: flex;
	justify-content: center;
	align-items: center;
	gap: 14px;
	font-size: 22px;
}
.orbit span {
	width: 48px;
	height: 48px;
	display: grid;
	place-items: center;
	border-radius: 16px;
	background: #2f665210;
}
.orbit i {
	color: #9cab9f;
	font-style: normal;
}
.hero h3 {
	margin: 20px 0 7px;
	font-size: 20px;
}
.hero p {
	color: #71827c;
}
.hero small {
	display: block;
	margin-top: 12px;
	color: #93a09b;
}
.symbol {
	font-size: 36px;
	color: var(--green);
}
.subject {
	gap: 12px;
	padding: 14px 16px;
	border-radius: 13px;
	background: #fffdf8;
	border: 1px solid #233b3315;
}
.subject > span {
	font-size: 23px;
}
.subject div {
	flex: 1;
}
.subject b,
.subject small {
	display: block;
}
.subject small {
	color: #82908b;
}
.opportunities {
	margin-top: 18px;
	display: grid;
	gap: 10px;
}
.opportunities > button {
	display: grid;
	grid-template-columns: 42px 1fr auto;
	gap: 14px;
	align-items: center;
	padding: 18px;
	border: 1px solid #233b3314;
	border-radius: 14px;
	background: #fffdf8;
	text-align: left;
}
.opportunities h3,
.opportunities p {
	margin: 0;
}
.opportunities p,
.opportunities small {
	color: #71827c;
}
.compose-head {
	justify-content: space-between;
	margin-bottom: 26px;
}
.title-input {
	display: block;
	width: min(560px, 70vw);
	margin-top: 5px;
	border: 0;
	border-bottom: 1px solid transparent;
	background: transparent;
	color: var(--ink);
	font:
		500 clamp(27px, 3vw, 38px) / 1.2 Georgia,
		serif;
}
.title-input:focus {
	border-bottom-color: #2f665244;
	outline: 0;
}
.status {
	padding: 7px 11px;
	border-radius: 20px;
	background: #b46b2b12;
	color: #96602f;
	font-size: 11px;
}
.status.ready {
	background: #2f665210;
	color: var(--green);
}
.flow {
	display: grid;
	grid-template-columns: minmax(130px, 0.7fr) 30px minmax(260px, 1.8fr) 30px minmax(130px, 0.7fr);
	align-items: stretch;
}
.boundary {
	padding: 14px;
	border-radius: 14px;
	background: #e8ece7;
}
.boundary > span {
	display: block;
	margin-bottom: 10px;
	color: #687973;
	font-size: 10px;
	letter-spacing: 1px;
	text-transform: uppercase;
}
.boundary > div {
	padding: 10px;
	margin-top: 7px;
	border-radius: 10px;
	background: #fffdf8;
}
.boundary b {
	float: right;
	color: #8fa099;
	font-size: 8px;
}
.boundary strong,
.boundary small {
	display: block;
}
.boundary small {
	color: #82908b;
	font-size: 9px;
}
.outputs {
	background: #e7eee9;
}
.line {
	align-self: center;
	height: 1px;
	background: #82908b55;
}
.steps {
	display: grid;
	gap: 9px;
}
.steps article {
	display: grid;
	grid-template-columns: 25px 35px 1fr;
	align-items: center;
	padding: 13px;
	border: 1px solid #233b3316;
	border-radius: 13px;
	background: #fffdf8;
}
.steps .number {
	color: #92a19b;
	font-size: 9px;
}
.steps .kind {
	width: 30px;
	height: 30px;
	display: grid;
	place-items: center;
	border-radius: 9px;
	background: #2f665210;
	color: var(--green);
}
.steps input {
	width: 100%;
	border: 0;
	background: transparent;
	font-weight: 600;
}
.steps input:focus {
	outline: 0;
}
.steps small {
	color: #82908b;
	font-size: 9px;
}
.drop {
	min-height: 72px;
	border: 1px dashed #2f665244;
	border-radius: 13px;
	background: #2f665206;
	color: var(--green);
}
.drop b,
.drop span,
.drop small {
	display: block;
	margin: auto;
}
.drop b {
	font-size: 20px;
}
.tool-row {
	display: flex;
	gap: 7px;
	margin: 17px 0;
}
.tool-row span {
	flex: 1;
}
.tool-row button.on {
	color: var(--green);
	border-color: #2f665244;
	background: #2f66520b;
}
.reuse {
	margin: 22px 0;
}
.reuse p,
.run-form p {
	margin: 2px 0 0;
	color: #7b8c85;
	font-size: 11px;
}
.reuse > div {
	display: flex;
	gap: 8px;
	overflow-x: auto;
	margin-top: 10px;
}
.reuse button {
	min-width: 200px;
	display: grid;
	grid-template-columns: 28px 1fr auto;
	gap: 7px;
	align-items: center;
	padding: 10px;
	border: 1px solid #233b3315;
	border-radius: 11px;
	background: #fffdf8;
	text-align: left;
}
.reuse button b,
.reuse button small {
	display: block;
}
.reuse button small {
	color: #82908b;
	font-size: 9px;
}
.run-form {
	margin-top: 22px;
	padding: 17px;
	border: 1px solid #233b3315;
	border-radius: 15px;
	background: #fffdf8;
}
.run-form header {
	justify-content: space-between;
}
.run-form header > small {
	padding: 4px 8px;
	border-radius: 20px;
	background: #233b3308;
	color: #7c8d86;
}
.fields {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
	gap: 10px;
	margin-top: 14px;
}
.fields label {
	display: grid;
	grid-template-columns: 80px 1fr;
	align-items: center;
	gap: 8px;
}
.fields label > span {
	font-weight: 600;
}
.fields label small {
	display: block;
	color: #8a9893;
	font-size: 9px;
}
.fields select,
.fields input:not([type="checkbox"]),
.connection-editor select {
	width: 100%;
	border: 1px solid #233b3320;
	border-radius: 8px;
	background: #f8f6ef;
	padding: 8px;
}
.issues {
	margin: 14px 0;
	padding: 10px 14px;
	border-radius: 10px;
	background: #b46b2b0d;
}
.issues p {
	display: flex;
	gap: 8px;
	margin: 4px 0;
	color: #875a32;
}
.advanced {
	margin: 16px 0;
	border-block: 1px solid #233b3315;
	padding: 11px 0;
}
.advanced summary {
	cursor: pointer;
}
.advanced summary small {
	float: right;
	color: #8b9994;
}
.advanced textarea {
	width: 100%;
	min-height: 260px;
	box-sizing: border-box;
	margin-top: 10px;
	padding: 12px;
	border: 1px solid #233b3320;
	border-radius: 9px;
	background: #202d28;
	color: #dbe8e0;
	font:
		11px / 1.55 ui-monospace,
		monospace;
}
.actions {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 18px;
}
.actions span {
	flex: 1;
}
.connection-editor {
	margin-top: 12px;
	padding: 17px;
	border-radius: 13px;
	background: #e8ede8;
}
.connection-editor label {
	display: inline-block;
	min-width: 220px;
	margin-right: 10px;
}
.connection-editor p {
	color: #687a73;
}
.activity {
	margin-top: 20px;
}
.activity h3 {
	border-bottom: 1px solid #233b3315;
	padding-bottom: 9px;
}
.activity h3 small {
	margin-left: 6px;
	color: #8b9994;
}
.activity article {
	gap: 12px;
	padding: 14px 2px;
	border-bottom: 1px solid #233b3310;
}
.activity article > i {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #45a46e;
}
.activity article > i.paused {
	background: #a6aaa6;
}
.activity article div {
	flex: 1;
}
.activity article p {
	margin: 2px 0;
	color: #74857f;
}
.run-state {
	width: 27px;
	height: 27px;
	display: grid;
	place-items: center;
	border-radius: 50%;
	background: #2f665212;
	color: var(--green);
}
.run-state.failed {
	background: #ad4a3c12;
	color: #ad4a3c;
}
.inspector {
	width: min(720px, 90vw);
	max-height: 85vh;
	padding: 24px;
	border: 0;
	border-radius: 18px;
	color: var(--ink);
	background: #fffdf8;
	box-shadow: 0 30px 90px #172b2360;
}
.inspector::backdrop {
	background: #172b2350;
	backdrop-filter: blur(4px);
}
.inspector header {
	justify-content: space-between;
}
.inspector h2 {
	margin: 3px 0;
}
.inspector header button {
	border: 0;
	background: transparent;
}
.inspector > p {
	color: #71827c;
}
.inspector pre {
	max-height: 50vh;
	overflow: auto;
	padding: 14px;
	border-radius: 10px;
	background: #202d28;
	color: #dce9e1;
	font-size: 10px;
}
.links {
	display: flex;
	gap: 7px;
}
.links button {
	border: 1px solid #233b3320;
	border-radius: 20px;
	background: transparent;
	padding: 6px 10px;
}
@media (max-width: 820px) {
	.workspace {
		grid-template-columns: 1fr;
	}
	.rail {
		display: none;
	}
	.top-actions .live,
	.top-actions .secondary:first-of-type {
		display: none;
	}
	.canvas {
		padding: 24px 16px 60px;
	}
	.flow {
		grid-template-columns: 1fr;
		gap: 9px;
	}
	.line {
		display: none;
	}
	.tool-row {
		flex-wrap: wrap;
	}
	.tabs > small {
		display: none;
	}
}
</style>
