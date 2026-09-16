<script lang="ts">
import { presentSkillArtifact, type SkillPresentation } from '@avenos/actors/studio/presentation'
import { invoke, isTauri } from '@tauri-apps/api/core'

let {
	presentation,
	onOpenStudio,
	onUseInSkill,
	onPrepareRun,
	onProvenance,
	onOpenChild
}: {
	presentation: SkillPresentation
	onOpenStudio: () => void
	onUseInSkill: () => void
	onPrepareRun: () => void
	onProvenance: () => void
	onOpenChild: (artifactId: string) => void
} = $props()

let child = $state<SkillPresentation | null>(null)
let childLoading = $state(false)
let childUnavailable = $state(false)
let expandedId = $state<string | null>(null)
let request = 0

async function expand(artifactId: string): Promise<void> {
	if (expandedId === artifactId) {
		expandedId = null
		child = null
		return
	}
	const current = ++request
	expandedId = artifactId
	child = null
	childUnavailable = false
	childLoading = true
	try {
		if (!isTauri()) throw new Error('Child metadata unavailable')
		const envelope = await invoke<{
			artifactId: string
			typeKey: string
			typeVersion: number
			artifactSha256?: string
			payload: unknown
		}>('artifact_get', { artifactId })
		if (current !== request || expandedId !== artifactId) return
		if (envelope.artifactId !== artifactId || envelope.typeKey !== 'studio.skill')
			throw new Error('Child metadata unavailable')
		child = presentSkillArtifact(
			artifactId,
			envelope.artifactSha256 ?? '',
			envelope.typeVersion,
			envelope.payload
		)
	} catch {
		if (current === request) childUnavailable = true
	} finally {
		if (current === request) childLoading = false
	}
}
</script>

<article class="min-h-0 flex-1 overflow-auto bg-surface-sunken/25 p-4 sm:p-6">
	<div
		class="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-border bg-surface-card shadow-sm"
	>
		<div class="h-1 bg-gradient-to-r from-primary via-info to-earth"></div>
		<header class="border-border border-b p-5 sm:p-7">
			<div class="flex items-center gap-3">
				<span
					aria-hidden="true"
					class="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary text-2xl"
					>✳</span
				>
				<div class="min-w-0">
					<p class="text-foreground/45 text-[length:var(--fs-micro)] uppercase tracking-wide">
						Saved Skill · version {presentation.version ?? '?'}
					</p>
					<h2 class="mt-0.5 font-semibold text-xl">{presentation.name}</h2>
				</div>
			</div>
			<p
				class="mt-3 break-all font-mono text-foreground/35 text-[length:var(--fs-micro)]"
				title="Exact artifact revision"
			>
				{presentation.artifactId}
			</p>
			{#if presentation.status !== 'valid'}
				<p role="status" class="mt-4 rounded-xl bg-warning-surface p-3 text-warning-ink text-sm">
					{presentation.issues[0]?.message ?? 'Preview unavailable.'}
					The artifact and its history remain inspectable.
				</p>
			{:else if presentation.version === 2}
				<p role="status" class="mt-4 rounded-xl bg-info-surface p-3 text-info-ink text-sm">
					This saved definition is previewable. Opening or running it awaits the shared v2 Studio
					runtime.
				</p>
			{/if}
		</header>

		{#if presentation.status === 'valid'}
			<section
				class="grid gap-5 border-border border-b p-5 sm:grid-cols-2 sm:p-7"
				aria-label="Skill interface"
			>
				<div>
					<h3 class="font-semibold text-foreground/55 text-xs uppercase tracking-wide">Given</h3>
					<div class="mt-3 flex flex-wrap gap-2">
						{#each presentation.inputs as port}
							<span class="rounded-xl bg-surface-sunken px-3 py-2 text-xs"
								>{port.name}
								<span class="ml-2 text-foreground/45">{port.type} · {port.cardinality}</span></span
							>
						{:else}
							<span class="text-foreground/45 text-sm">No artifact input</span>
						{/each}
					</div>
				</div>
				<div>
					<h3 class="font-semibold text-foreground/55 text-xs uppercase tracking-wide">Produces</h3>
					<div class="mt-3 flex flex-wrap gap-2">
						{#each presentation.outputs as port}
							<span class="rounded-xl bg-info-surface px-3 py-2 text-info-ink text-xs"
								>{port.name}
								<span class="ml-2 opacity-70">{port.type} · {port.cardinality}</span></span
							>
						{:else}
							<span class="text-foreground/45 text-sm">No domain output declared</span>
						{/each}
					</div>
				</div>
			</section>

			{#if presentation.parameters.length}
				<section class="border-border border-b p-5 sm:p-7" aria-label="Skill settings">
					<h3 class="font-semibold text-foreground/55 text-xs uppercase tracking-wide">Settings</h3>
					<div class="mt-3 flex flex-wrap gap-2">
						{#each presentation.parameters as parameter}
							<span class="rounded-xl border border-border bg-surface-raised px-3 py-2 text-xs">
								{parameter.name}
								<span class="ml-2 text-foreground/45"
									>{parameter.type}
									· {parameter.required ? 'required' : 'optional'}</span
								>
							</span>
						{/each}
					</div>
				</section>
			{/if}

			<section class="border-border border-b p-5 sm:p-7" aria-label="Saved Skill steps">
				<div class="flex items-center justify-between">
					<h3 class="font-semibold text-foreground/55 text-xs uppercase tracking-wide">
						Saved route
					</h3>
					<span class="text-foreground/35 text-xs">
						{presentation.steps.length}
						steps
						{#if presentation.structure.branches}
							· {presentation.structure.branches} branch
						{/if}
					</span>
				</div>
				<ol class="mt-4 space-y-2">
					{#each presentation.steps as step, index}
						<li
							class="rounded-2xl border border-border bg-surface-raised p-3"
							style={`margin-left: ${Math.min(step.depth, 4) * 1.25}rem`}
						>
							<div class="flex items-center gap-3">
								<span
									aria-hidden="true"
									class="grid size-8 shrink-0 place-items-center rounded-xl bg-surface-sunken font-mono text-foreground/50 text-xs"
									>{index + 1}</span
								>
								<div class="min-w-0 flex-1">
									{#if step.context}
										<p class="text-primary text-[length:var(--fs-micro)] uppercase tracking-wide">
											{step.context}
										</p>
									{/if}
									<p class="font-medium text-sm">{step.label}</p>
									<p class="text-foreground/40 text-xs">
										{step.kind === 'achieve' || step.kind === 'goal' ? 'Open goal · planned when prepared' : step.kind === 'review' ? 'Human review' : step.kind === 'skill' ? 'Reusable child Skill' : step.kind === 'forEach' ? 'For each member' : step.kind}
									</p>
								</div>
								{#if step.childArtifactId}
									<button
										type="button"
										onclick={() => void expand(step.childArtifactId!)}
										aria-expanded={expandedId === step.childArtifactId}
										class="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-surface-sunken"
									>
										{expandedId === step.childArtifactId ? 'Close' : 'Inspect child'}
									</button>
								{/if}
							</div>
							{#if expandedId === step.childArtifactId}
								<div class="mt-3 border-border border-t pt-3 text-xs">
									{#if childLoading}
										<p role="status">Loading child …</p>
									{:else if childUnavailable}
										<p role="status">
											Child details are unavailable here. Its exact reference remains in the saved
											Skill.
										</p>
									{:else if child}
										<p class="font-medium">
											{child.name}
											· {child.inputs.length} inputs · {child.outputs.length} outputs
										</p>
										<button
											type="button"
											onclick={() => onOpenChild(step.childArtifactId!)}
											class="mt-2 text-primary hover:underline"
										>
											Open exact child ↗
										</button>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			</section>

			<section class="border-border border-b p-5 text-xs sm:p-7">
				<h3 class="font-semibold text-foreground/55 uppercase tracking-wide">
					Limits and requirements
				</h3>
				<div class="mt-3 flex flex-wrap gap-2 text-foreground/60">
					{#if presentation.policy.maxInvocations}
						<span class="rounded-full bg-surface-sunken px-3 py-1"
							>Up to {presentation.policy.maxInvocations} calls</span
						>
					{/if}
					{#if presentation.policy.maxDepth}
						<span class="rounded-full bg-surface-sunken px-3 py-1"
							>Depth {presentation.policy.maxDepth}</span
						>
					{/if}
					{#if presentation.policy.allowModel !== undefined}
						<span class="rounded-full bg-surface-sunken px-3 py-1"
							>Model {presentation.policy.allowModel ? 'allowed' : 'off'}</span
						>
					{/if}
					<span class="rounded-full bg-warning-surface px-3 py-1 text-warning-ink"
						>Effect status needs a live check</span
					>
				</div>
			</section>
		{/if}

		<footer class="flex flex-wrap gap-2 p-5 sm:p-7">
			{#if presentation.status === 'valid' && presentation.version === 1}
				<button
					type="button"
					onclick={onOpenStudio}
					class="rounded-full bg-primary px-4 py-2 text-primary-foreground text-xs hover:opacity-90"
				>
					Open in Studio
				</button>
				<button
					type="button"
					onclick={onUseInSkill}
					class="rounded-full border border-border px-4 py-2 text-xs hover:bg-surface-sunken"
				>
					Use in a Skill
				</button>
				<button
					type="button"
					onclick={onPrepareRun}
					class="rounded-full border border-border px-4 py-2 text-xs hover:bg-surface-sunken"
				>
					Prepare run
				</button>
			{/if}
			<button
				type="button"
				onclick={onProvenance}
				class="rounded-full border border-border px-4 py-2 text-xs hover:bg-surface-sunken"
			>
				Provenance
			</button>
		</footer>
	</div>
</article>
