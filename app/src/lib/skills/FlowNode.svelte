<script lang="ts">
import { Handle, Position } from '@xyflow/svelte'
import type { FlowInstanceState, FlowNodeDef } from './skill'

/**
 * One workflow node as an n8n-style card: kind badge, name, one-line
 * subtitle, and the recipe ports — requires down the left, provides down
 * the right, exactly where the derived wires attach. Triggers wear the
 * green entrance look; a door is another skill standing in one dashed box.
 */
const {
	data
}: {
	data: {
		node: FlowNodeDef
		selected: boolean
		door?: boolean
		/** Instance overlay: this node's state in a RUNNING skill instance. */
		instance?: FlowInstanceState
		outputCount?: number
	}
} = $props()

const n = $derived(data.node)
const verb = $derived(n.type.split(':')[0])

/**
 * The node's KIND and its RUN state are both variants of the `flow-node`
 * actor, which was written for this card. They used to be two local maps of
 * Tailwind classes here — `INSTANCE_RING` and `BADGE` — which meant the node's
 * state vocabulary lived in this file while the intent stream's lived in
 * another, and the promise that "a node that is running and an intent that is
 * working are one meaning" was kept by hand.
 */
const kind = $derived(data.door ? 'door' : (n.kind ?? verb))
const RUN_LABEL: Record<string, string> = {
	done: 'erledigt',
	running: 'läuft',
	retrying: 'wird wiederholt',
	error: 'fehlgeschlagen',
	review: 'Prüfung nötig',
	skipped: 'übersprungen',
	waiting: 'wartet'
}
const runState = $derived(data.instance ?? (n.live ? 'running' : undefined))
</script>

<div
	class="flow-node flow-node--kind-{kind}{runState ? ` flow-node--run-${runState}` : ''}"
	aria-selected={data.selected ? 'true' : undefined}
>
	<Handle type="target" position={Position.Left} />
	<div class="flow-node-head">
		<span class="flow-node-kind">{data.door ? 'skill' : verb}</span>
		<span class="flow-node-name">{data.door ? `→ ${n.name}` : n.name}</span>
		{#if runState}
			<!-- The run marker. The actor's `run` variant decides its colour, so
			     the shape is all this file supplies. `title` carries the meaning
			     for a pointer; the variant carries it for the eye. -->
			<span class="flow-node-mark" title={RUN_LABEL[runState] ?? runState}></span>
		{/if}
	</div>
	<p class="flow-node-about">{n.about}</p>
	{#if data.outputCount}
		<p class="flow-node-meta">
			{data.outputCount} {data.outputCount === 1 ? 'Artefakt' : 'Artefakte'}
		</p>
	{/if}
	<div class="flow-node-ports">
		<ul class="flow-node-requires">
			{#each n.requires ?? [] as f (f)}
				<li class="flow-node-port">{f}</li>
			{/each}
		</ul>
		<ul class="flow-node-provides">
			{#each n.provides ?? [] as f (f)}
				<li class="flow-node-port">{f}</li>
			{/each}
		</ul>
	</div>
	<Handle type="source" position={Position.Right} />
</div>
