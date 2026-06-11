<script lang="ts">
/**
 * The brain roundtrip panel (plan 0018, E5): always shows the LATEST roundtrip for the
 * last human message — what was STORED and what the auto-assembled context RECALLED,
 * broken down by context layer (L0 self · L1 gist · L2 entities · L3 search), plus the
 * inner query and budget. This is the exact context fed to the AI for this turn.
 */
import { brainRoundtrip } from '$lib/identities/talk-brain-roundtrip.svelte'

const { identityId }: { identityId: string } = $props()

const rt = $derived(
	brainRoundtrip.latest &&
		brainRoundtrip.latest.identity.trim().toLowerCase() === identityId.trim().toLowerCase()
		? brainRoundtrip.latest
		: null
)

/** L3 hits minus the just-stored memory (it would always find itself). */
const recalled = $derived((rt?.trace?.recalled ?? []).filter((r) => r.id !== rt?.memoryId))

function snip(s: string, n = 110): string {
	return s.length > n ? `${s.slice(0, n)}…` : s
}
</script>

<div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto py-1 text-xs">
	<div class="flex items-center gap-2">
		<span class="font-semibold tracking-tight">Brain roundtrip</span>
		{#if rt}
			<span class="text-muted-foreground ml-auto">
				{rt.phase === 'storing' ? 'storing…' : rt.phase === 'recalling' ? 'recalling…' : ''}
			</span>
		{/if}
	</div>

	{#if !rt}
		<p class="text-muted-foreground">
			Send a message — this panel shows what the brain stores and recalls for it.
		</p>
	{:else}
		<!-- STORED -->
		<section class="rounded-lg border border-border/60 bg-card/30 p-2">
			<div class="mb-1 font-medium text-emerald-500">stored</div>
			<p class="text-foreground/90">“{snip(rt.content)}”</p>
			{#if rt.memoryId}
				<p class="text-muted-foreground mt-1 truncate font-mono text-[10px]">{rt.memoryId}</p>
			{/if}
		</section>

		{#if rt.error}
			<section class="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-red-400">
				{rt.error}
			</section>
		{:else if rt.trace}
			{@const t = rt.trace}
			<!-- inner query -->
			<section class="rounded-lg border border-border/60 bg-card/30 p-2">
				<div class="mb-1 font-medium">inner query</div>
				<p class="text-muted-foreground italic">“{snip(t.query)}”</p>
			</section>

			<!-- L0 -->
			<section class="rounded-lg border border-border/60 bg-card/30 p-2">
				<div class="mb-1 font-medium"><span class="text-sky-400">L0</span> self</div>
				<p class="text-muted-foreground">{snip(t.l0Self, 160)}</p>
			</section>

			<!-- L1 -->
			<section class="rounded-lg border border-border/60 bg-card/30 p-2">
				<div class="mb-1 font-medium"><span class="text-sky-400">L1</span> gist</div>
				{#if t.l1Gist.length === 0}
					<p class="text-muted-foreground">—</p>
				{:else}
					<ul class="space-y-1">
						{#each t.l1Gist as g}
							<li class="text-muted-foreground">· {snip(g)}</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- L2 -->
			<section class="rounded-lg border border-border/60 bg-card/30 p-2">
				<div class="mb-1 font-medium"><span class="text-sky-400">L2</span> entities</div>
				{#if t.entities.length === 0}
					<p class="text-muted-foreground">—</p>
				{:else}
					<div class="flex flex-wrap gap-1">
						{#each t.entities as e}
							<span class="rounded-full border border-border/60 px-2 py-0.5">
								{e.name}
								<span class="text-muted-foreground">({e.kind})</span>
							</span>
						{/each}
					</div>
				{/if}
			</section>

			<!-- L3 -->
			<section class="rounded-lg border border-border/60 bg-card/30 p-2">
				<div class="mb-1 font-medium">
					<span class="text-sky-400">L3</span>
					recall · {recalled.length} hit{recalled.length === 1 ? '' : 's'}
				</div>
				{#if recalled.length === 0}
					<p class="text-muted-foreground">nothing relevant (abstained)</p>
				{:else}
					<ol class="space-y-1.5">
						{#each recalled as r}
							<li>
								<span
									class="mr-1 rounded px-1 py-0.5 font-mono text-[10px] {r.via === 'vector'
										? 'bg-violet-500/20 text-violet-300'
										: r.via === 'bm25'
											? 'bg-amber-500/20 text-amber-300'
											: 'bg-emerald-500/20 text-emerald-300'}"
									>{r.via}</span
								>
								<span class="text-muted-foreground font-mono text-[10px]"
									>#{r.rank} {r.score.toFixed(3)}</span
								>
								<p class="text-foreground/90">{snip(r.snippet)}</p>
							</li>
						{/each}
					</ol>
				{/if}
			</section>

			<!-- working window -->
			<section class="rounded-lg border border-border/60 bg-card/30 p-2">
				<div class="mb-1 font-medium">working window · {t.working.length}</div>
				{#if t.working.length === 0}
					<p class="text-muted-foreground">—</p>
				{:else}
					<ul class="space-y-1">
						{#each t.working as w}
							<li class="text-muted-foreground">
								<span class="font-mono text-[10px]">{w.authorRole}</span> {snip(w.snippet, 80)}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<p class="text-muted-foreground text-[10px]">
				{t.budget.usedChars}/{t.budget.maxChars}
				chars
				{#if t.budget.droppedRecalled + t.budget.droppedWorking > 0}
					· dropped {t.budget.droppedRecalled + t.budget.droppedWorking}
				{/if}
				· embedder: {t.embedder} · sent to the AI as context this turn
			</p>
		{/if}
	{/if}
</div>
