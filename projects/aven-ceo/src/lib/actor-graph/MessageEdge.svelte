<script lang="ts">
import { BaseEdge, EdgeLabel, getBezierPath } from '@xyflow/svelte'

const props = $props<{
	id?: string
	sourceX: number
	sourceY: number
	targetX: number
	targetY: number
	sourcePosition?: unknown
	targetPosition?: unknown
	label?: string
}>()
</script>

<BaseEdge path={getBezierPath(props)[0]} style="stroke:#f59e0b;stroke-width:2" />
<EdgeLabel>
	<div
		class="nodrag nopan absolute rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 shadow"
		style={`transform: translate(-50%, -50%) translate(${getBezierPath(props)[1]}px,${getBezierPath(props)[2]}px);`}
	>
		{String(props.label ?? '')}
	</div>
</EdgeLabel>