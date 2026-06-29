<script lang="ts">
import {
	EXAMPLE_FLOWS,
	type Flow,
	isComposite,
	RESOURCE_LABEL,
	type RecipeNode,
	resourceSchema
} from '@avenos/aven-vibes'
import { t } from '$lib/i18n'
import FlowGraph from '$lib/shell/FlowGraph.svelte'
import { openDbSchema } from '$lib/shell/nav.svelte'

// board 0083 — Skills view = TEMPLATES only, rendered via the shared FlowGraph (real edges + labels,
// pan/zoom). Left = skill list, center = the flow DAG (composites navigate into sub-skills), right =
// the selected actor's config. Instance runs + traces live in RunsView.
let { containerName = 'aven-vibes-skills' }: { containerName?: string } = $props()

let selectedId = $state<string>(EXAMPLE_FLOWS[0]?.id ?? '')
let selectedNodeId = $state<string | null>(null)

const selected = $derived<Flow | null>(EXAMPLE_FLOWS.find((f) => f.id === selectedId) ?? null)
const nodeById = $derived(new Map((selected?.nodes ?? []).map((n) => [n.id, n])))
const selectedNode = $derived<RecipeNode | null>(
	selectedNodeId ? (nodeById.get(selectedNodeId) ?? null) : null
)

function resLabel(flow: Flow | null, k: string): string {
	return flow?.resourceLabels?.[k] ?? RESOURCE_LABEL[k] ?? k
}
function selectFlow(id: string): void {
	selectedId = id
	selectedNodeId = null
}
// A leaf opens its detail aside; a composite navigates into its reusable sub-skill.
function onSelect(id: string): void {
	const n = nodeById.get(id)
	if (!n) return
	if (isComposite(n) && n.flowRef) selectFlow(n.flowRef)
	else selectedNodeId = id
}
</script>

<div
	class="flex h-full max-h-full min-h-[320px] w-full min-w-0 gap-3"
	data-container={containerName}
>
	<!-- Left: skill list (templates) -->
	<aside class="border-border flex w-48 shrink-0 flex-col rounded-[var(--radius-lg)] border">
		<p class="border-border border-b p-3 text-sm font-semibold">{t('mainnet.skills.title')}</p>
		<div class="min-h-0 flex-1 overflow-y-auto p-1.5">
			{#each EXAMPLE_FLOWS as f (f.id)}
				<button
					type="button"
					class="mb-1 block w-full rounded-[var(--radius)] px-2.5 py-2 text-left transition-colors {f.id ===
					selectedId
						? 'bg-primary/10 text-foreground'
						: 'text-muted-foreground hover:bg-card'}"
					onclick={() => selectFlow(f.id)}
				>
					<span class="block truncate text-[13px] font-medium">{f.name}</span>
					<span class="text-muted-foreground block text-[10px]">{f.nodes.length} Aktoren</span>
				</button>
			{/each}
		</div>
	</aside>

	<!-- Center: the flow as a Svelte Flow graph -->
	<div
		class="border-border min-h-0 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-lg)] border"
	>
		{#if !selected}
			<p class="text-muted-foreground p-8 text-center text-sm">{t('mainnet.skills.pick')}</p>
		{:else}
			<div class="flex h-full flex-col">
				<div class="border-border border-b p-3">
					<h2 class="text-foreground text-base font-semibold">{selected.name}</h2>
					<p class="text-muted-foreground text-xs">{selected.description}</p>
				</div>
				<div class="min-h-0 flex-1">
					<FlowGraph flow={selected} {selectedNodeId} {onSelect} />
				</div>
			</div>
		{/if}
	</div>

	<!-- Right: selected actor detail (the template's config) -->
	{#if selectedNode}
		<aside class="border-border flex w-80 shrink-0 flex-col rounded-[var(--radius-lg)] border">
			<div class="border-border flex items-start justify-between gap-2 border-b p-3">
				<div class="min-w-0">
					<p class="text-foreground truncate text-sm font-semibold">{selectedNode.name}</p>
					<p class="text-muted-foreground truncate font-mono text-[10px]">{selectedNode.actor}</p>
				</div>
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground text-xs"
					onclick={() => (selectedNodeId = null)}
				>
					✕
				</button>
			</div>
			<div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs">
				{#if selectedNode.note}
					<p class="text-muted-foreground">{selectedNode.note}</p>
				{/if}
				<div>
					<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
						Inbox
					</p>
					<div class="flex flex-wrap gap-1">
						{#each selectedNode.inputs as r (r)}
							{#if resourceSchema(r)}
								<button
									type="button"
									class="bg-muted text-foreground ring-primary/40 hover:bg-primary/10 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ring-1"
									title={`Schema »${resourceSchema(r)}« in der DB öffnen`}
									onclick={() => openDbSchema(resourceSchema(r) ?? '')}
								>
									▦ {resLabel(selected, r)}
								</button>
							{:else}
								<span class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]"
									>{resLabel(selected, r)}</span
								>
							{/if}
						{/each}
					</div>
				</div>
				<div>
					<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
						Output
					</p>
					<div class="flex flex-wrap gap-1">
						{#each selectedNode.outputs as r (r)}
							{#if resourceSchema(r)}
								<button
									type="button"
									class="bg-primary/10 text-foreground ring-primary/40 hover:bg-primary/20 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ring-1"
									title={`Schema »${resourceSchema(r)}« in der DB öffnen`}
									onclick={() => openDbSchema(resourceSchema(r) ?? '')}
								>
									▦ {resLabel(selected, r)}
								</button>
							{:else}
								<span class="bg-primary/10 text-foreground rounded px-1.5 py-0.5 text-[10px]"
									>{resLabel(selected, r)}</span
								>
							{/if}
						{/each}
					</div>
				</div>
				{#if selectedNode.llm}
					<div>
						<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
							LLM
						</p>
						<div class="text-foreground flex flex-wrap gap-1">
							<span class="border-border rounded border px-1.5 py-0.5 text-[10px]"
								>{selectedNode.llm.model}</span
							>
							{#if selectedNode.llm.mode}
								<span class="border-border rounded border px-1.5 py-0.5 text-[10px]"
									>{selectedNode.llm.mode}</span
								>
							{/if}
							{#if selectedNode.llm.vision}
								<span class="border-border rounded border px-1.5 py-0.5 text-[10px]">vision</span>
							{/if}
							{#if selectedNode.llm.temperature != null}
								<span class="border-border rounded border px-1.5 py-0.5 text-[10px]"
									>temp {selectedNode.llm.temperature}</span
								>
							{/if}
						</div>
					</div>
				{/if}
				{#if selectedNode.tools?.length}
					<div>
						<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
							Tools
						</p>
						<div class="flex flex-wrap gap-1">
							{#each selectedNode.tools as tool (tool)}
								<span class="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-[10px]"
									>{tool}</span
								>
							{/each}
						</div>
					</div>
				{/if}
				{#if selectedNode.system_prompt}
					<div>
						<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
							System-Prompt
						</p>
						<p
							class="text-foreground border-border bg-muted/20 rounded border p-2 text-[11px] leading-relaxed whitespace-pre-wrap"
						>
							{selectedNode.system_prompt}
						</p>
					</div>
				{/if}
			</div>
		</aside>
	{/if}
</div>
