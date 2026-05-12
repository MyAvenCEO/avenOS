<script lang="ts">
import { BaseEdge, EdgeLabel, getBezierPath, type EdgeProps } from '@xyflow/svelte'

const props = $props<EdgeProps>()

const [path, labelX, labelY] = getBezierPath(props)
</script>

<BaseEdge path={path} animated style="stroke:#f59e0b;stroke-width:2" />
<EdgeLabel>
	<div
		class="nodrag nopan absolute rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 shadow"
		style={`transform: translate(-50%, -50%) translate(${labelX}px,${labelY}px);`}
	>
		{String(props.label ?? '')}
	</div>
</EdgeLabel>