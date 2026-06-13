<script lang="ts">
/**
 * The brain roundtrip panel (plan 0018, E5): always shows the LATEST roundtrip for the
 * last human message — what was STORED and what the auto-assembled context RECALLED,
 * broken down by context layer (L0 self · L1 gist · L2 entities · L3 search), plus the
 * inner query and budget. This is the exact context fed to the AI for this turn.
 */
import { type BrainEntity, brainDebugExportSave, brainEntities, brainRebuildGraph } from '$lib/brain/api'
import {
	brainActivity,
	brainDreamLog,
	brainRoundtrip
} from '$lib/identities/talk-brain-roundtrip.svelte'
import TalkBrainEntityDetail from '$lib/identities/TalkBrainEntityDetail.svelte'
import { copyToClipboard } from '$lib/runtime/clipboard'

const { identityId }: { identityId: string } = $props()

let tab = $state<'activity' | 'context' | 'dreaming' | 'entities'>('activity')

/** Live activity timeline for THIS identity (or null). */
const activity = $derived(
	brainActivity.identity?.trim().toLowerCase() === identityId.trim().toLowerCase()
		? brainActivity
		: null
)

// A ticking clock so a RUNNING step shows live elapsed time (e.g. recall stuck at 36s is
// visible second-by-second, not a frozen "running…"). Ticks 4×/s only while a turn is live.
let now = $state(Date.now())
$effect(() => {
	if (!activity?.running) return
	const id = setInterval(() => (now = Date.now()), 250)
	return () => clearInterval(id)
})
/** Live ms for a running step, or its final duration once done. */
function stepMs(s: { status: string; startMs: number; ms?: number }): number {
	return s.status === 'running' ? Math.max(0, now - s.startMs) : (s.ms ?? 0)
}
function fmtMs(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}
/** Total turn time = sum of every step's (live or final) duration. */
const activityTotal = $derived((activity?.steps ?? []).reduce((acc, s) => acc + stepMs(s), 0))

let exported = $state(false)
/** Copy the turn's step timings as JSON for offline perf analysis of the recall path. */
async function exportActivity(): Promise<void> {
	const a = activity
	if (!a) return
	const payload = {
		identity: a.identity,
		exportedAtMs: Date.now(),
		totalMs: activityTotal,
		steps: a.steps.map((s) => ({
			kind: s.kind,
			label: s.label,
			detail: s.detail,
			status: s.status,
			ms: stepMs(s)
		}))
	}
	if (await copyToClipboard(JSON.stringify(payload, null, 2))) {
		exported = true
		setTimeout(() => (exported = false), 1500)
	}
}

let exportingSession = $state(false)
let exportResult = $state<string | null>(null)
/**
 * Export the FULL debug session (board 0029 M3): the whole message history + every per-round
 * ContextTrace + the full persisted dreaming/activity log. The Tauri webview can't do a browser
 * blob download, so the Rust side WRITES the JSON to a file and returns its path; we show the path
 * and copy it to the clipboard so it's easy to find and share.
 */
async function downloadDebugSession(): Promise<void> {
	if (exportingSession) return
	exportingSession = true
	exportResult = null
	try {
		const saved = await brainDebugExportSave(identityId)
		await copyToClipboard(saved.path)
		exportResult = `Saved (${saved.messages} msgs · ${saved.rounds} rounds · ${saved.dreamLog} log) — path copied:\n${saved.path}`
	} catch (err) {
		exportResult = `Export failed: ${err instanceof Error ? err.message : String(err)}`
		console.error('debug export failed', err)
	} finally {
		exportingSession = false
		setTimeout(() => (exportResult = null), 12000)
	}
}

/** Per-kind accent for the activity timeline. */
function activityStyle(kind: string): { dot: string; text: string } {
	switch (kind) {
		case 'store':
			return { dot: 'bg-emerald-400', text: 'text-emerald-400' }
		case 'recall':
			return { dot: 'bg-sky-400', text: 'text-sky-400' }
		case 'llm':
			return { dot: 'bg-violet-400', text: 'text-violet-400' }
		case 'tool':
			return { dot: 'bg-amber-400', text: 'text-amber-400' }
		case 'respond':
			return { dot: 'bg-primary', text: 'text-primary' }
		case 'error':
			return { dot: 'bg-red-400', text: 'text-red-400' }
		default:
			return { dot: 'bg-muted-foreground', text: 'text-muted-foreground' }
	}
}
/** When set, the aside shows the entity detail view (back button returns to the tabs). */
let detail = $state<string | null>(null)

// The brain's entities for THIS identity — shown as walkable mini-cards in the Entities tab.
// Newest first (ObjectId is time-ordered). Re-fetched whenever the dream log advances, so
// freshly-typed entities appear as dreaming mines them.
let entities = $state<BrainEntity[]>([])
$effect(() => {
	const id = identityId
	// Touch the dream log length + running flag so this re-runs as dreaming writes entities.
	void brainDreamLog.entries.length
	void brainDreamLog.running
	brainEntities(id)
		.then((list) => {
			if (id === identityId) entities = [...list].reverse()
		})
		.catch(() => {
			if (id === identityId) entities = []
		})
})

let rebuilding = $state(false)
/** Wipe the derived graph (memories untouched) so dreams re-build it clean + typed. */
async function rebuildGraph() {
	if (rebuilding) return
	rebuilding = true
	try {
		await brainRebuildGraph(identityId)
		entities = await brainEntities(identityId).then((l) => [...l].reverse())
	} catch {
		// Surfaced via the (now-empty) grid; a failed wipe leaves the graph intact.
	} finally {
		rebuilding = false
	}
}

const rt = $derived(
	brainRoundtrip.latest &&
		brainRoundtrip.latest.identity.trim().toLowerCase() === identityId.trim().toLowerCase()
		? brainRoundtrip.latest
		: null
)

/** Dream log for THIS identity (or null). */
const log = $derived(
	brainDreamLog.identity?.trim().toLowerCase() === identityId.trim().toLowerCase()
		? brainDreamLog
		: null
)

/** L3 hits minus the just-stored memory (it would always find itself). */
const recalled = $derived((rt?.trace?.recalled ?? []).filter((r) => r.id !== rt?.memoryId))

function snip(s: string, n = 110): string {
	return s.length > n ? `${s.slice(0, n)}…` : s
}

/** Per-phase accent + glyph for the dreaming log. */
function phaseStyle(phase: string): { dot: string; text: string } {
	switch (phase) {
		case 'enrich':
			return { dot: 'bg-sky-400', text: 'text-sky-400' }
		case 'extract':
		case 'extract_ready':
			return { dot: 'bg-rose-400', text: 'text-rose-400' }
		case 'merge':
			return { dot: 'bg-violet-400', text: 'text-violet-400' }
		case 'decay':
			return { dot: 'bg-amber-400', text: 'text-amber-400' }
		case 'verify':
			return { dot: 'bg-emerald-400', text: 'text-emerald-400' }
		case 'consolidate':
			return { dot: 'bg-primary', text: 'text-primary' }
		case 'error':
			return { dot: 'bg-red-400', text: 'text-red-400' }
		default:
			return { dot: 'bg-muted-foreground', text: 'text-muted-foreground' }
	}
}
</script>

{#if detail}
	<!-- Entity detail overlays the tabs; the back button returns to the brain view. -->
	<TalkBrainEntityDetail
		{identityId}
		name={detail}
		onBack={() => (detail = null)}
		onOpen={(n) => (detail = n)}
	/>
{:else}
<div class="flex h-full min-h-0 flex-col py-1 text-xs">
	<!-- Tabs: live turn activity · the context the AI saw · the dreaming consolidation log. -->
	<div class="mb-2 flex shrink-0 items-center gap-1 border-b border-border/60 pb-1.5">
		<button
			type="button"
			class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold tracking-tight transition {tab ===
			'activity'
				? 'bg-card text-foreground'
				: 'text-muted-foreground hover:text-foreground'}"
			onclick={() => (tab = 'activity')}
		>
			Activity
			{#if activity?.running}
				<span class="size-1.5 animate-pulse rounded-full bg-violet-400"></span>
			{/if}
		</button>
		<button
			type="button"
			class="rounded-md px-2 py-1 text-[11px] font-semibold tracking-tight transition {tab ===
			'context'
				? 'bg-card text-foreground'
				: 'text-muted-foreground hover:text-foreground'}"
			onclick={() => (tab = 'context')}
		>
			Context
		</button>
		<button
			type="button"
			class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold tracking-tight transition {tab ===
			'dreaming'
				? 'bg-card text-foreground'
				: 'text-muted-foreground hover:text-foreground'}"
			onclick={() => (tab = 'dreaming')}
		>
			Dreaming
			{#if log?.running}
				<span class="size-1.5 animate-pulse rounded-full bg-violet-400"></span>
			{/if}
		</button>
		<button
			type="button"
			class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold tracking-tight transition {tab ===
			'entities'
				? 'bg-card text-foreground'
				: 'text-muted-foreground hover:text-foreground'}"
			onclick={() => (tab = 'entities')}
		>
			Entities
			{#if entities.length > 0}
				<span class="text-[10px] text-muted-foreground">{entities.length}</span>
			{/if}
		</button>
		{#if tab === 'context' && rt}
			<span class="text-muted-foreground ml-auto">
				{rt.phase === 'storing' ? 'storing…' : rt.phase === 'recalling' ? 'recalling…' : ''}
			</span>
		{/if}
	</div>

	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
		{#if tab === 'activity'}
			<!-- ACTIVITY TAB: the live, step-by-step pipeline for the current turn —
			     store → recall → each model round → each tool call → respond, with timing. -->
			{#if !activity || (activity.steps.length === 0 && !activity.running)}
				<p class="text-muted-foreground">
					Send a message — this shows each step (store · recall · model rounds · tools) live.
				</p>
			{:else}
				<!-- Header: live total turn time + export-for-perf button. -->
				<div class="flex items-center gap-2 border-b border-border/40 pb-1.5">
					<span class="font-medium">turn</span>
					<span class="font-mono {activity.running ? 'text-primary' : 'text-muted-foreground'}"
						>{fmtMs(activityTotal)}</span
					>
					<button
						type="button"
						class="border-border/60 text-muted-foreground hover:bg-card hover:text-foreground ml-auto rounded-md border px-2 py-0.5 text-[10px] transition"
						onclick={() => void exportActivity()}
					>
						{exported ? 'copied ✓' : 'export'}
					</button>
					<button
						type="button"
						class="border-border/60 text-muted-foreground hover:bg-card hover:text-foreground rounded-md border px-2 py-0.5 text-[10px] transition disabled:opacity-50"
						disabled={exportingSession}
						title="Download the full session: messages + every per-round context + dreaming log"
						onclick={() => void downloadDebugSession()}
					>
						{exportingSession ? 'exporting…' : 'export session'}
					</button>
				</div>
				{#if exportResult}
					<pre
						class="border-border/40 text-muted-foreground mt-1 whitespace-pre-wrap break-all rounded-md border bg-muted/30 p-2 text-[10px] leading-snug">{exportResult}</pre>
				{/if}
				<ol class="space-y-2">
					{#each activity.steps as s (s.id)}
						{@const as = activityStyle(s.kind)}
						<li class="flex gap-2">
							{#if s.status === 'error'}
								<span class="mt-1 size-1.5 shrink-0 rounded-full bg-red-400"></span>
							{:else if s.status === 'running'}
								<span class="mt-1 size-1.5 shrink-0 animate-pulse rounded-full {as.dot}"></span>
							{:else}
								<span class="mt-1 size-1.5 shrink-0 rounded-full {as.dot}"></span>
							{/if}
							<div class="min-w-0 flex-1">
								<div class="flex items-baseline gap-1.5">
									<span class="font-semibold {s.status === 'error' ? 'text-red-400' : as.text}"
										>{s.label}</span
									>
									<!-- Live elapsed while running (ticks 4×/s), final duration once done. -->
									<span
										class="font-mono text-[10px] {s.status === 'running'
											? 'text-primary'
											: 'text-muted-foreground'}">{fmtMs(stepMs(s))}</span
									>
								</div>
								{#if s.detail}
									<p class="text-muted-foreground whitespace-pre-line break-words leading-snug">
									{s.detail}
								</p>
								{/if}
							</div>
						</li>
					{/each}
					{#if activity.running}
						<li class="text-muted-foreground flex items-center gap-2">
							<span class="size-1.5 animate-pulse rounded-full bg-violet-400"></span>
							working…
						</li>
					{/if}
				</ol>
			{/if}
		{:else if tab === 'context'}
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
									<button
										type="button"
										class="rounded-full border border-border/60 px-2 py-0.5 transition hover:border-primary/60 hover:bg-card"
										onclick={() => (detail = e.name)}
									>
										{e.name}
										<span class="text-muted-foreground">({e.kind})</span>
									</button>
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
											: r.via === 'graph'
												? 'bg-sky-500/20 text-sky-300'
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

					<!-- raw prompt: the assembled context VERBATIM — the panel above is the
					     summary view; this IS what the LLM saw (100% receipt, board 0023). -->
					{#if rt.prompt}
						<details class="rounded-lg border border-border/60 bg-card/30 p-2">
							<summary class="cursor-pointer font-medium">
								raw prompt · {rt.prompt.length} chars · verbatim
							</summary>
							<pre
								class="text-muted-foreground mt-1 max-h-96 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-snug"
							>{rt.prompt}</pre>
						</details>
					{/if}
				{/if}
			{/if}
		{:else if tab === 'dreaming'}
			<!-- DREAMING TAB: the live consolidation log (entities live in their own tab now). -->
			<div class="mb-1 font-medium text-muted-foreground">consolidation log</div>
			{#if !log || (log.entries.length === 0 && !log.running)}
				<p class="text-muted-foreground">No dream yet — it runs after each message.</p>
			{:else}
				<ol class="space-y-2">
					{#each log.entries as e, i (i)}
						{@const ps = phaseStyle(e.phase)}
						<li class="flex gap-2">
							<span class="mt-1 size-1.5 shrink-0 rounded-full {ps.dot}"></span>
							<div class="min-w-0 flex-1">
								<div class="flex items-baseline gap-1.5">
									<span class="font-semibold {ps.text}">{e.phase}</span>
									<span class="text-muted-foreground font-mono text-[10px]">{e.ms}ms</span>
									{#if e.tokens > 0}
										<span class="text-muted-foreground font-mono text-[10px]"
											>· {e.tokens} tok</span
										>
									{/if}
								</div>
								<p class="text-foreground/90 leading-snug">{e.label}</p>
								{#if e.entities && e.entities.length > 0}
									<!-- The entities this extract step typed — clickable cards into the detail view. -->
									<div class="mt-1.5 flex flex-wrap gap-1">
										{#each e.entities as ent (ent.name)}
											<button
												type="button"
												class="flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 transition hover:border-primary/60 hover:bg-card"
												onclick={() => (detail = ent.name)}
											>
												<span class="text-foreground/90">{ent.name}</span>
												<span class="text-[10px] text-sky-400">{ent.kind}</span>
											</button>
										{/each}
									</div>
								{/if}
							</div>
						</li>
					{/each}
					{#if log.running}
						<li class="text-muted-foreground flex items-center gap-2">
							<span class="size-1.5 animate-pulse rounded-full bg-violet-400"></span>
							dreaming…
						</li>
					{/if}
				</ol>
			{/if}
		{:else}
			<!-- ENTITIES TAB: the knowledge graph the brain has built — every entity it graphed +
			     typed. Click a card to walk its facts + bonds; rebuild re-mines it clean. -->
			<section class="rounded-lg border border-border/60 bg-card/30 p-2">
				<div class="mb-1.5 flex items-center gap-2">
					<span class="font-medium"><span class="text-sky-400">entities</span> · {entities.length}</span>
					<button
						type="button"
						class="ml-auto rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition hover:border-primary/60 hover:text-foreground disabled:opacity-50"
						title="Wipe the entity graph (memories kept) and re-mine it clean + typed over the next dreams"
						disabled={rebuilding}
						onclick={rebuildGraph}
					>
						{rebuilding ? 'rebuilding…' : 'rebuild'}
					</button>
				</div>
				{#if entities.length === 0}
					<p class="text-muted-foreground">— none graphed yet. Ingest a few notes; dreaming types them.</p>
				{:else}
					<div class="grid grid-cols-2 gap-1.5">
						{#each entities.slice(0, 80) as e (e.id)}
							<button
								type="button"
								class="flex flex-col items-start rounded-md border border-border/60 px-2 py-1 text-left transition hover:border-primary/60 hover:bg-card"
								onclick={() => (detail = e.name)}
							>
								<span class="w-full truncate font-medium text-foreground/90">{e.name}</span>
								<span class="text-[10px] text-sky-400">{e.kind}</span>
							</button>
						{/each}
					</div>
					{#if entities.length > 80}
						<p class="text-muted-foreground mt-1.5 text-[10px]">
							+{entities.length - 80} more — click any card to walk the graph
						</p>
					{/if}
				{/if}
			</section>
		{/if}
	</div>
</div>
{/if}
