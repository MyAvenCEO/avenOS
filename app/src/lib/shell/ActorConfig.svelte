<script lang="ts">
import type { RecipeNode } from '@avenos/aven-skills'
import { chatToolDefinitions } from '@avenos/skills/tools'

// board 0099 — the shared "actor insight" panel: surfaces what an actor actually runs — its system
// prompt (LLM actors) AND the config of every tool it dispatches (the registered tool definition +
// its parameter JSON-Schema). Used by BOTH the Runs step detail aside and the Skills actor aside so
// selecting a node shows the same inspectable config in either explorer.
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

{#if !node.system_prompt && tools.length === 0}
	<p class="text-muted-foreground text-[11px] italic">
		Kein System-Prompt oder Tool-Config für diesen Aktor.
	</p>
{/if}
