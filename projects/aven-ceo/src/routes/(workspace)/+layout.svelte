<script lang="ts">
import WorkspaceHeader from '$lib/workspace/WorkspaceHeader.svelte'

let { children: pageContent } = $props()
</script>

<div
	class="box-border flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-background px-6 pt-4 pb-24 sm:px-8 sm:pt-5 sm:pb-28"
>
	<WorkspaceHeader />
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
		{@render pageContent()}
	</div>
</div>

<style>
:global(body) {
	background-color: #e8ede1;
}
</style>
