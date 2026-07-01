<script lang="ts">
import type { RecipeNode } from '@avenos/aven-skills'
import { chatToolDefinitions } from '@avenos/skills/tools'
import { loadContext, type NodeContextPayload } from '$lib/data/client'

// board 0099/0100 — the shared "actor insight" panel: surfaces what an actor actually runs — its system
// prompt (LLM actors), the config of every tool it dispatches, AND (board 0100) the ACTUAL content of any
// attached-context resource the actor declares (a reference dictionary, a live registry) via the universal
// `/api/context/:provider` endpoint. Generic — used by BOTH the Runs step aside and the Skills actor aside.
let { node, promptOpen = false }: { node: RecipeNode; promptOpen?: boolean } = $props()

const defs = chatToolDefinitions()
function toolDef(name: string) {
	return defs.find((d) => d.function.name === name)
}
// An actor may itself BE a tool (e.g. `data_crud`) and/or list extra tools it invokes; de-dupe both.
const toolNames = $derived(
	[...(node.actor ? [node.actor] : []), ...(node.tools ?? [])].filter(
		(n, i, a) => a.indexOf(n) === i
	)
)
const tools = $derived(
	toolNames.map((name) => ({ name, def: toolDef(name) })).filter((t) => t.def)
)

// Lazily fetch a declared context resource's ACTUAL content when its <details> is opened. board 0100.
let ctxCache = $state<Record<string, NodeContextPayload | 'loading' | 'error'>>({})
async function fetchCtx(provider: string): Promise<void> {
	if (ctxCache[provider]) return
	ctxCache[provider] = 'loading'
	try {
		ctxCache[provider] = await loadContext(provider)
	} catch {
		ctxCache[provider] = 'error'
	}
}
</script>

{#if node.system_prompt}
	<div>
		<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
			System-Prompt
		</p>
		<details open={promptOpen}>
			<summary
				class="text-muted-foreground hover:text-foreground cursor-pointer text-[11px] select-none"
			>
				{node.system_prompt.length} Zeichen — anzeigen
			</summary>
			<pre
				class="text-foreground border-border bg-muted/30 mt-1 max-h-64 overflow-auto rounded border p-2 text-[11px] leading-relaxed whitespace-pre-wrap">{node.system_prompt}</pre>
		</details>
	</div>
{/if}

{#each tools as { name, def } (name)}
	<div>
		<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
			Tool · <span class="text-foreground font-mono">{name}</span>
		</p>
		{#if def?.function.description}
			<p class="text-muted-foreground mb-1.5 text-[11px] leading-relaxed">
				{def.function.description}
			</p>
		{/if}
		{#if def?.function.parameters}
			<details>
				<summary
					class="text-muted-foreground hover:text-foreground cursor-pointer text-[11px] select-none"
				>
					Parameter-Schema
				</summary>
				<pre
					class="text-foreground border-border bg-muted/30 mt-1 max-h-64 overflow-auto rounded border p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">{JSON.stringify(
						def.function.parameters,
						null,
						2
					)}</pre>
			</details>
		{/if}
	</div>
{/each}

{#each node.context ?? [] as ctx (ctx.provider)}
	{@const loaded = ctxCache[ctx.provider]}
	<div>
		<p class="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
			Kontext · <span class="text-foreground">{ctx.label}</span>
		</p>
		{#if ctx.note}
			<p class="text-muted-foreground mb-1.5 text-[11px] leading-relaxed">{ctx.note}</p>
		{/if}
		<details ontoggle={(e) => e.currentTarget.open && fetchCtx(ctx.provider)}>
			<summary
				class="text-muted-foreground hover:text-foreground cursor-pointer text-[11px] select-none"
			>
				Angehängten Inhalt anzeigen
			</summary>
			{#if loaded === 'loading' || loaded === undefined}
				<p class="text-muted-foreground mt-1 text-[11px] italic">Lädt …</p>
			{:else if loaded === 'error'}
				<p class="text-destructive mt-1 text-[11px]">Konnte den Kontext nicht laden.</p>
			{:else}
				{#if loaded.meta}
					<div class="mt-1 mb-1 flex flex-wrap gap-1">
						{#each Object.entries(loaded.meta) as [k, v] (k)}
							<span class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]"
								>{k}: {v}</span
							>
						{/each}
					</div>
				{/if}
				{#if loaded.kind === 'list'}
					<ul
						class="border-border bg-muted/30 mt-1 max-h-64 space-y-0.5 overflow-auto rounded border p-2 text-[11px]"
					>
						{#each loaded.items ?? [] as it (it.name)}
							<li>
								<span class="text-foreground font-mono">{it.name}</span>{#if it.gloss}<span
										class="text-muted-foreground"
									>
										— {it.gloss}</span
									>{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<pre
						class="text-foreground border-border bg-muted/30 mt-1 max-h-64 overflow-auto rounded border p-2 text-[10px] leading-relaxed whitespace-pre-wrap">{loaded.text}</pre>
				{/if}
			{/if}
		</details>
	</div>
{/each}

{#if !node.system_prompt && tools.length === 0 && !(node.context ?? []).length}
	<p class="text-muted-foreground text-[11px] italic">
		Kein System-Prompt oder Tool-Config für diesen Aktor.
	</p>
{/if}
