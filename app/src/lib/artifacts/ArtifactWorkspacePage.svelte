<script lang="ts">
import ArtifactsPage from './ArtifactsPage.svelte'
import ArtifactLibraryPage from './ArtifactLibraryPage.svelte'

let surface = $state<'library' | 'history'>('library')
</script>

<div class="flex min-h-0 w-full flex-1 flex-col gap-2 p-3">
	<nav class="flex shrink-0 gap-2" aria-label="Artefaktansicht">
		<button type="button" aria-current={surface === 'library' ? 'page' : undefined}
			class="rounded-lg px-3 py-1.5 text-sm {surface === 'library' ? 'bg-primary text-primary-foreground' : 'border border-border'}"
			onclick={() => surface = 'library'}>Bibliothek</button>
		<button type="button" aria-current={surface === 'history' ? 'page' : undefined}
			class="rounded-lg px-3 py-1.5 text-sm {surface === 'history' ? 'bg-primary text-primary-foreground' : 'border border-border'}"
			onclick={() => surface = 'history'}>Herkunft & Details</button>
	</nav>
	{#if surface === 'library'}
		<ArtifactLibraryPage />
	{:else}
		<ArtifactsPage />
	{/if}
</div>
