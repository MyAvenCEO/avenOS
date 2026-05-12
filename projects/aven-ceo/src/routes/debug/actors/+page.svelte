<script lang="ts">
import ActorGraph from '$lib/actor-graph/ActorGraph.svelte';
</script>

<svelte:head>
	<title>Actor debug graph — AvenOS</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-[96rem] flex-col gap-4 px-4 py-4">
	<div>
		<p class="text-[10px] font-bold uppercase tracking-[0.26em] opacity-40">Debug</p>
		<h1 class="text-xl font-semibold tracking-tight">Actors</h1>
		<p class="text-sm opacity-60">Live runtime topology with ownership edges and transient message flows.</p>
	</div>
	<ActorGraph />
</section>