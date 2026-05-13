<script lang="ts">
	type RuntimeTreeItem = {
		id: string
		label: string
		sublabel?: string
		kind: 'root' | 'actor'
		projection?: 'structural' | 'communication'
		actorId?: string | null
		pathActors?: string[]
		payload?: unknown
		hasChildren?: boolean
		childCount?: number
		children?: RuntimeTreeItem[]
		isExpanded?: boolean
		isLoading?: boolean
		isSelected?: boolean
	}

	let {
		item,
		onSelect,
		onToggle
	}: {
		item: RuntimeTreeItem
		onSelect: (item: RuntimeTreeItem) => void | Promise<void>
		onToggle: (item: RuntimeTreeItem) => void | Promise<void>
	} = $props()

	function hasChildren(node: RuntimeTreeItem): boolean {
		return node.hasChildren ?? (node.children?.length ?? 0) > 0
	}

	function childCount(node: RuntimeTreeItem): number {
		return node.childCount ?? node.children?.length ?? 0
	}
</script>

<li class="tree-item">
	<div class:root-node={item.kind === 'root'} class:selected={item.isSelected} class="tree-row rounded-xl border border-transparent bg-white/50">
		<div class="flex items-start gap-2 px-2 py-2">
			{#if hasChildren(item)}
				<button
					type="button"
					class="mt-[1px] inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs hover:bg-black/5"
					onclick={() => onToggle(item)}
					aria-label={item.isExpanded ? 'Collapse node' : 'Expand node'}
				>
					<span class:rotate-90={item.isExpanded} class="tree-caret opacity-70">▸</span>
				</button>
			{:else}
				<span class="inline-flex h-6 w-6 shrink-0 items-center justify-center text-xs opacity-35">•</span>
			{/if}

			<button type="button" class="min-w-0 flex-1 text-left" onclick={() => onSelect(item)}>
				<div class="flex items-start gap-2">
					<span class="mt-[1px] text-xs opacity-50">{item.kind === 'root' ? '🌳' : '👤'}</span>
					<div class="min-w-0 flex-1">
						<div class="break-all text-sm font-medium">{item.label}</div>
						{#if item.sublabel}
							<div class="text-xs opacity-60">{item.sublabel}</div>
						{/if}
						{#if hasChildren(item)}
							<div class="mt-0.5 text-[11px] opacity-45">
								{#if item.isLoading}
									Loading…
								{:else}
									{childCount(item)} child node{childCount(item) === 1 ? '' : 's'}
								{/if}
							</div>
						{/if}
					</div>
				</div>
			</button>
		</div>
	</div>

	{#if item.isExpanded && (item.children?.length ?? 0) > 0}
		<ul class="tree-children ml-4 border-l-2 border-slate-300/75 pl-3">
			{#each item.children ?? [] as child (child.id)}
				<svelte:self {onSelect} {onToggle} item={child} />
			{/each}
		</ul>
	{/if}
</li>

<style>
	.tree-item {
		list-style: none;
		margin: 0.25rem 0;
	}

	.tree-row {
		transition:
			background 120ms ease,
			border-color 120ms ease,
			box-shadow 120ms ease;
	}

	.tree-row:hover {
		background: rgb(255 255 255 / 0.82);
		border-color: rgb(203 213 225 / 0.9);
	}

	.tree-row.selected {
		border-color: rgb(15 23 42 / 0.18);
		background: rgb(255 255 255 / 0.9);
		box-shadow: 0 10px 30px rgb(15 23 42 / 0.06);
	}

	.root-node {
		background: rgb(255 255 255 / 0.72);
		border-color: rgb(203 213 225 / 0.9);
	}

	.tree-children {
		list-style: none;
		margin: 0.35rem 0 0.25rem 0;
		padding-top: 0.05rem;
	}

	.tree-caret {
		display: inline-block;
		transition: transform 120ms ease;
	}

	.rotate-90 {
		transform: rotate(90deg);
	}
</style>