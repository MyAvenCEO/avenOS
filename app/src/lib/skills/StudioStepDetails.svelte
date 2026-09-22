<script lang="ts">
import {
	parseStudioSkillV2,
	STUDIO_SKILL_ARTIFACT_VERSION,
	type StudioPortBinding,
	type StudioSkillStep,
	type StudioSkillV2
} from '@avenos/actors'
import StudioStepDetails from './StudioStepDetails.svelte'
import { type StudioArtifact, studioRequest } from './studio.svelte'

let {
	step,
	siblings,
	depth = 0,
	ownerArtifactId = null,
	oninspect
}: {
	step: StudioSkillStep
	siblings: StudioSkillStep[]
	depth?: number
	ownerArtifactId?: string | null
	oninspect: (selection: { stepId: string; childArtifactId: string | null } | null) => void
} = $props()
let child = $state<StudioSkillV2 | null>(null)
let loadedId = $state<string | null>(null)
let loading = $state(false)
let error = $state('')
const childId = $derived(
	step.kind === 'skill'
		? step.skillArtifactId
		: step.kind === 'forEach'
			? step.childSkillArtifactId
			: null
)
const inputs = $derived(
	step.kind === 'invoke' || step.kind === 'skill'
		? step.inputs
		: step.kind === 'forEach'
			? step.childInputs
			: step.kind === 'review'
				? step.subjects
				: {}
)
const settings = $derived(step.kind === 'invoke' || step.kind === 'skill' ? step.parameters : {})
$effect(() => {
	if (loadedId && loadedId !== childId) {
		child = null
		loadedId = null
	}
})
function source(binding: StudioPortBinding): string {
	if (binding.kind === 'none') return 'Not supplied'
	if (binding.kind === 'input') return `Input · ${binding.port}`
	if (binding.kind === 'item') return 'The current item'
	return `${siblings.find((item) => item.id === binding.stepId)?.label ?? binding.stepId} → ${binding.port}`
}
async function lookInside() {
	if (!childId || loading) return
	loading = true
	error = ''
	const requestedId = childId
	try {
		const { artifact } = await studioRequest<{ artifact: StudioArtifact }>('inspect', {
			artifactId: requestedId
		})
		if (childId !== requestedId) return
		if (
			artifact.typeKey !== 'studio.skill' ||
			artifact.typeVersion !== STUDIO_SKILL_ARTIFACT_VERSION
		)
			throw Error('Not a skill')
		child = parseStudioSkillV2(artifact.payload)
		loadedId = requestedId
		oninspect({ stepId: step.id, childArtifactId: childId })
	} catch {
		error = 'This saved skill could not be opened. Your flow is unchanged. Try again.'
	} finally {
		loading = false
	}
}
</script>

<details
	class="step-details"
	ontoggle={event => oninspect(event.currentTarget.open ? { stepId: step.id, childArtifactId: childId ?? ownerArtifactId } : null)}
>
	<summary>Connections & details</summary>
	<div class="detail-body">
		{#if step.kind === 'forEach'}
			<p class="rule">Repeat for each item in <b>{source(step.collection)}</b>.</p>
		{:else if step.kind === 'when'}
			<p class="rule">
				{#if step.condition.kind === 'presence'}
					If <b>{source(step.condition.from)}</b> is present
				{:else}
					If <b>{source(step.condition.from)}</b> · {step.condition.path.slice(1)} equals
					<b>{JSON.stringify(step.condition.equals)}</b>
				{/if}
			</p>
		{:else if step.kind === 'review' || step.kind === 'achieve'}
			<p class="rule">Planning only. This step cannot run yet.</p>
		{/if}
		{#if Object.keys(inputs).length}
			<dl aria-label="Step inputs">
				{#each Object.entries(inputs) as [name, binding]}
					<div>
						<dt>{name}</dt>
						<dd>{source(binding)}</dd>
					</div>
				{/each}
			</dl>
		{/if}
		{#if Object.keys(settings).length}
			<dl aria-label="Step settings">
				{#each Object.entries(settings) as [name, binding]}
					<div>
						<dt>{name}</dt>
						<dd>
							{binding.kind === 'input-field' ? `From ${binding.port} → ${binding.path.slice(1).replaceAll('/', ' → ')}` : binding.kind === 'parameter' ? `Run setting · ${binding.name}` : String(typeof binding.value === 'object' ? JSON.stringify(binding.value) : binding.value).slice(0, 300)}
						</dd>
					</div>
				{/each}
			</dl>
		{/if}
		{#if childId}
			<p class="version">
				Saved version · {childId.slice(0, 8)}. Updates elsewhere do not change this flow.
			</p>
			{#if depth < 8}
				{#if child}
					<section class="inside" aria-label={`Inside ${child.name}`}>
						<h4>{child.name}</h4>
						{#each child.steps as inner, index (inner.id)}
							<div class="inner-step">
								<strong>{index + 1}. {inner.label}</strong>
								<StudioStepDetails
									step={inner}
									siblings={child.steps}
									depth={depth + 1}
									ownerArtifactId={childId}
									{oninspect}
								/>
							</div>
						{/each}
					</section>
				{:else}
					<button disabled={loading} onclick={() => void lookInside()}>
						{loading ? 'Opening…' : 'Look inside this skill'}
					</button>
				{/if}
			{:else}
				<p>Ask Aven to inspect this deeper saved skill.</p>
			{/if}
		{/if}
		{#if step.kind === 'when' && depth < 8}
			<div class="branches">
				{#each Object.entries(step.branches) as [name, branch]}
					<section aria-label={`Branch ${name}`}>
						<h4>{name === 'otherwise' || name === 'absent' ? 'Otherwise' : 'When true'}</h4>
						{#each branch.steps as inner, index (inner.id)}
							<div class="inner-step">
								<strong>{index + 1}. {inner.label}</strong>
								<StudioStepDetails
									step={inner}
									siblings={[...siblings, ...branch.steps]}
									depth={depth + 1}
									{ownerArtifactId}
									{oninspect}
								/>
							</div>
						{:else}
							<p>Continue without another action.</p>
						{/each}
					</section>
				{/each}
			</div>
		{/if}
		{#if error}
			<p role="alert">{error}</p>
		{/if}
	</div>
</details>

<style>
.step-details {
	grid-column: 1 / -1;
	min-width: 0;
	margin-top: 8px;
	font-size: 12px;
}
summary {
	cursor: pointer;
	color: var(--green);
	padding: 5px 0;
}
summary:focus-visible,
button:focus-visible {
	outline: 2px solid var(--green);
	outline-offset: 3px;
}
.detail-body {
	border-top: 1px solid #233b3316;
	padding-top: 8px;
	overflow-wrap: anywhere;
}
p {
	margin: 4px 0 10px;
	line-height: 1.5;
}
.rule {
	color: var(--ink);
}
.version {
	color: #687973;
	font-size: 11px;
}
dl {
	margin: 0 0 12px;
}
dl > div {
	display: grid;
	grid-template-columns: minmax(65px, 0.5fr) minmax(0, 1fr);
	gap: 12px;
	padding: 5px 0;
}
dt {
	color: #687973;
}
dd {
	margin: 0;
	white-space: pre-wrap;
	max-height: 130px;
	overflow: auto;
}
button {
	border: 1px solid #233b3322;
	border-radius: 8px;
	padding: 8px 10px;
	background: transparent;
	font: inherit;
	cursor: pointer;
}
.inside,
.branches > section {
	border-left: 2px solid #82908b55;
	padding: 4px 0 4px 10px;
	margin: 10px 0;
}
h4 {
	font-size: 12px;
	margin: 0 0 10px;
}
.inner-step {
	margin: 6px 0;
	padding: 8px;
	background: #2f665206;
	border-radius: 8px;
}
.inner-step > strong {
	font-size: 12px;
}
.branches {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
	gap: 12px;
}
[role="alert"] {
	color: var(--color-error-ink, #923b2a);
	margin-top: 8px;
}
</style>
