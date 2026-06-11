<script lang="ts">
import { onMount } from 'svelte'
import { browser } from '$app/environment'
import { formatBytes, formatBytesPair } from '$lib/asr/format'
import {
	asrState,
	cancelDownload,
	deleteModel,
	downloadFraction,
	type LocalModel,
	listLocalModels,
	startDownload
} from '$lib/asr/model-download-store'
import { t } from '$lib/i18n'
import {
	cancelLlmDownload,
	deleteLlmModel,
	type LocalModel as LlmLocalModel,
	listLocalLlmModels,
	llmDownloadFraction,
	llmState,
	startLlmDownload,
	startLlmReadiness
} from '$lib/llm/model-download-store'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import {
	cancelTtsDownload,
	deleteTtsModel,
	listLocalTtsModels,
	startTtsDownload,
	startTtsReadiness,
	type LocalModel as TtsLocalModel,
	ttsDownloadFraction,
	ttsState
} from '$lib/tts/model-download-store'
import {
	cancelEmbedDownload,
	deleteEmbedModel,
	embedDownloadFraction,
	embedState,
	listLocalEmbedModels,
	type LocalEmbedModel,
	startEmbedDownload,
	startEmbedReadiness
} from '$lib/embed/model-download-store'

const tauri = $derived(browser && isTauriRuntime())
let local = $state<LocalModel[]>([])
let busyId = $state<string | null>(null)

// On-device LLM (LFM2.5) — separate model managed alongside the voice model.
let llmLocal = $state<LlmLocalModel[]>([])
let llmBusyId = $state<string | null>(null)

// On-device TTS (MOSS-TTS-Nano) — separate model, manual download here.
let ttsLocal = $state<TtsLocalModel[]>([])
let ttsBusyId = $state<string | null>(null)

let embedLocal: LocalEmbedModel[] = $state([])
let embedBusy = $state(false)
const embedFraction = $derived(embedDownloadFraction($embedState))
const embedActiveOnDisk = $derived(embedLocal.find((m) => m.isActive) ?? embedLocal[0])
async function onEmbedStart() {
	await startEmbedDownload()
}
async function onEmbedStop() {
	await cancelEmbedDownload()
	embedLocal = await listLocalEmbedModels()
}
async function onEmbedDelete(id: string) {
	embedBusy = true
	try {
		await deleteEmbedModel(id)
		embedLocal = await listLocalEmbedModels()
	} finally {
		embedBusy = false
	}
}

onMount(() => {
	let unlistenLlm: (() => void) | undefined
	let unlistenEmbed: (() => void) | undefined
	let unlistenTts: (() => void) | undefined
	void startLlmReadiness().then((u) => (unlistenLlm = u))
	void startEmbedReadiness().then((u) => (unlistenEmbed = u))
	void listLocalEmbedModels().then((m) => (embedLocal = m))
	void startTtsReadiness().then((u) => (unlistenTts = u))
	return () => {
		unlistenLlm?.()
		unlistenEmbed?.()
		unlistenTts?.()
	}
})

async function onTtsStop() {
	await cancelTtsDownload()
	ttsLocal = await listLocalTtsModels()
}
async function onTtsStart() {
	await startTtsDownload()
}
async function onTtsDelete(id: string) {
	ttsBusyId = id
	try {
		await deleteTtsModel(id)
		ttsLocal = await listLocalTtsModels()
	} finally {
		ttsBusyId = null
	}
}

async function onLlmStop() {
	await cancelLlmDownload()
	llmLocal = await listLocalLlmModels()
}
async function onLlmStart() {
	await startLlmDownload()
}
async function onLlmDelete(id: string) {
	llmBusyId = id
	try {
		await deleteLlmModel(id)
		llmLocal = await listLocalLlmModels()
	} finally {
		llmBusyId = null
	}
}

// Parakeet is a speech-to-text model (audio in → text out). AvenOS uses it for
// voice-note transcription.
const MODALITIES = ['audio', 'text'] as const

async function refreshLocal() {
	if (!tauri) return
	local = await listLocalModels()
}

async function onStop() {
	await cancelDownload()
	await refreshLocal()
}

async function onStart() {
	await startDownload()
}

async function onDelete(id: string) {
	busyId = id
	try {
		await deleteModel(id)
		await refreshLocal()
	} finally {
		busyId = null
	}
}

// Re-scan the on-disk listing whenever readiness flips (e.g. a download
// finishes), so freshly fetched weights show up without a manual refresh.
$effect(() => {
	if (!tauri) {
		local = []
		return
	}
	void $asrState.status
	let cancelled = false
	void listLocalModels().then((m) => {
		if (!cancelled) local = m
	})
	return () => {
		cancelled = true
	}
})

const activeOnDisk = $derived(local.find((m) => m.isActive))
const others = $derived(local.filter((m) => !m.isActive))
const fraction = $derived(downloadFraction($asrState))
const statusKey = $derived($asrState.status)

// Re-scan the LLM listing whenever its readiness flips.
$effect(() => {
	if (!tauri) {
		llmLocal = []
		return
	}
	void $llmState.status
	let cancelled = false
	void listLocalLlmModels().then((m) => {
		if (!cancelled) llmLocal = m
	})
	return () => {
		cancelled = true
	}
})
const llmActiveOnDisk = $derived(llmLocal.find((m) => m.isActive))
const llmFraction = $derived(llmDownloadFraction($llmState))
const llmStatusKey = $derived($llmState.status)

// Re-scan the TTS listing whenever its readiness flips.
$effect(() => {
	if (!tauri) {
		ttsLocal = []
		return
	}
	void $ttsState.status
	let cancelled = false
	void listLocalTtsModels().then((m) => {
		if (!cancelled) ttsLocal = m
	})
	return () => {
		cancelled = true
	}
})
const ttsActiveOnDisk = $derived(ttsLocal.find((m) => m.isActive))
const ttsFraction = $derived(ttsDownloadFraction($ttsState))
const ttsStatusKey = $derived($ttsState.status)
</script>

<svelte:head>
	<title>{t('models.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">{t('models.title')}</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">{t('models.subtitle')}</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">{t('models.needsDesktop')}</p>
	{:else}
		<!-- Voice model — live status + download progress. -->
		<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-1.5">
						<h2 class="truncate text-sm font-semibold tracking-tight">{$asrState.model}</h2>
						{#each MODALITIES as m (m)}
							<span
								class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
								>{t(`models.modalities.${m}`)}</span
							>
						{/each}
					</div>
					{#if $asrState.quant}
						<p class="text-muted-foreground mt-1 text-[11px]">{$asrState.quant}</p>
					{/if}
					{#if activeOnDisk}
						<p class="text-muted-foreground mt-0.5 font-mono text-[11px]">
							{formatBytes(activeOnDisk.sizeBytes)}
							{t('models.onDisk')}
						</p>
					{/if}
				</div>
				<div class="flex shrink-0 items-center gap-2">
					<span
						class="text-xs font-medium {statusKey === 'ready'
							? 'text-status-success'
							: statusKey === 'error'
								? 'text-status-error'
								: 'text-muted-foreground'}"
					>
						{t(`models.status.${statusKey}`)}
					</span>
					{#if statusKey === 'downloading'}
						<button
							type="button"
							class="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground/80 outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary/30"
							onclick={onStop}
						>
							{t('models.stop')}
						</button>
					{:else if statusKey === 'idle' || statusKey === 'error'}
						<button
							type="button"
							class="rounded-full border border-primary/40 px-2.5 py-1 text-[11px] font-medium text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/30"
							onclick={onStart}
						>
							{activeOnDisk ? t('models.load') : t('models.download')}
						</button>
					{/if}
					{#if activeOnDisk && statusKey !== 'unavailable'}
						<button
							type="button"
							class="rounded-full border border-status-error/40 px-2.5 py-1 text-[11px] font-medium text-status-error outline-none transition-colors hover:bg-status-error/10 focus-visible:ring-2 focus-visible:ring-status-error/30 disabled:opacity-40"
							disabled={busyId === activeOnDisk.id}
							onclick={() => activeOnDisk && onDelete(activeOnDisk.id)}
						>
							{busyId === activeOnDisk.id ? t('models.deleting') : t('models.delete')}
						</button>
					{/if}
				</div>
			</div>

			{#if statusKey === 'downloading'}
				<div class="space-y-1.5">
					<div class="flex justify-end">
						<span class="font-mono text-[10px] tabular-nums text-muted-foreground"
							>{formatBytesPair($asrState.receivedBytes, $asrState.totalBytes)}</span
						>
					</div>
					<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
						{#if fraction == null}
							<div class="h-full w-1/3 animate-pulse rounded-full bg-primary/70"></div>
						{:else}
							<div
								class="h-full rounded-full bg-primary transition-[width] duration-300"
								style={`width: ${Math.round(fraction * 100)}%`}
							></div>
						{/if}
					</div>
				</div>
			{:else if statusKey === 'loading'}
				<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div class="h-full w-1/3 animate-pulse rounded-full bg-primary/70"></div>
				</div>
			{/if}

			{#if statusKey === 'error' && $asrState.error}
				<p class="text-status-error select-text text-[11px] leading-snug">{$asrState.error}</p>
			{/if}
			{#if statusKey === 'unavailable'}
				<p class="text-muted-foreground text-[11px] leading-snug">
					{t('models.secondaryInstance')}
				</p>
			{/if}
		</section>

		<!-- On-device text LLM (LFM2.5-8B-A1B ONNX) — live status + download progress. -->
		<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-1.5">
						<h2 class="truncate text-sm font-semibold tracking-tight">{$llmState.model}</h2>
						<span
							class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
							>{t('models.modalities.text')}</span
						>
					</div>
					{#if $llmState.quant}
						<p class="text-muted-foreground mt-1 text-[11px]">{$llmState.quant}</p>
					{/if}
					{#if llmActiveOnDisk}
						<p class="text-muted-foreground mt-0.5 font-mono text-[11px]">
							{formatBytes(llmActiveOnDisk.sizeBytes)}
							{t('models.onDisk')}
						</p>
					{/if}
				</div>
				<div class="flex shrink-0 items-center gap-2">
					<span
						class="text-xs font-medium {llmStatusKey === 'ready'
							? 'text-status-success'
							: llmStatusKey === 'error'
								? 'text-status-error'
								: 'text-muted-foreground'}"
					>
						{t(`models.status.${llmStatusKey}`)}
					</span>
					{#if llmStatusKey === 'downloading'}
						<button
							type="button"
							class="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground/80 outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary/30"
							onclick={onLlmStop}
						>
							{t('models.stop')}
						</button>
					{:else if llmStatusKey === 'idle' || llmStatusKey === 'error'}
						<button
							type="button"
							class="rounded-full border border-primary/40 px-2.5 py-1 text-[11px] font-medium text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/30"
							onclick={onLlmStart}
						>
							{llmActiveOnDisk ? t('models.load') : t('models.download')}
						</button>
					{/if}
					{#if llmActiveOnDisk && llmStatusKey !== 'unavailable'}
						<button
							type="button"
							class="rounded-full border border-status-error/40 px-2.5 py-1 text-[11px] font-medium text-status-error outline-none transition-colors hover:bg-status-error/10 focus-visible:ring-2 focus-visible:ring-status-error/30 disabled:opacity-40"
							disabled={llmBusyId === llmActiveOnDisk.id}
							onclick={() => llmActiveOnDisk && onLlmDelete(llmActiveOnDisk.id)}
						>
							{llmBusyId === llmActiveOnDisk.id ? t('models.deleting') : t('models.delete')}
						</button>
					{/if}
				</div>
			</div>

			{#if llmStatusKey === 'downloading'}
				<div class="space-y-1.5">
					<div class="flex justify-end">
						<span class="font-mono text-[10px] tabular-nums text-muted-foreground"
							>{formatBytesPair($llmState.receivedBytes, $llmState.totalBytes)}</span
						>
					</div>
					<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
						{#if llmFraction == null}
							<div class="h-full w-1/3 animate-pulse rounded-full bg-primary/70"></div>
						{:else}
							<div
								class="h-full rounded-full bg-primary transition-[width] duration-300"
								style={`width: ${Math.round(llmFraction * 100)}%`}
							></div>
						{/if}
					</div>
				</div>
			{:else if llmStatusKey === 'loading'}
				<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div class="h-full w-1/3 animate-pulse rounded-full bg-primary/70"></div>
				</div>
			{/if}

			{#if llmStatusKey === 'error' && $llmState.error}
				<p class="text-status-error select-text text-[11px] leading-snug">{$llmState.error}</p>
			{/if}
			{#if llmStatusKey === 'unavailable'}
				<p class="text-muted-foreground text-[11px] leading-snug">
					{t('models.secondaryInstance')}
				</p>
			{/if}
		</section>

		<!-- Brain embeddings (EmbeddingGemma-300m) — same flow as the other local models. -->
		<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-1.5">
						<h2 class="truncate text-sm font-semibold tracking-tight">{$embedState.model}</h2>
						<span
							class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
							>brain</span
						>
					</div>
					{#if embedActiveOnDisk}
						<p class="text-muted-foreground mt-0.5 font-mono text-[11px]">
							{formatBytes(embedActiveOnDisk.sizeBytes)}
							{t('models.onDisk')}
						</p>
					{/if}
				</div>
				<div class="flex shrink-0 items-center gap-2">
					<span
						class="text-xs font-medium {$embedState.status === 'ready'
							? 'text-status-success'
							: $embedState.status === 'error'
								? 'text-status-error'
								: 'text-muted-foreground'}"
					>
						{$embedState.status}
					</span>
					{#if $embedState.status === 'downloading'}
						<button
							type="button"
							class="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground/80 outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary/30"
							onclick={onEmbedStop}
						>
							{t('models.stop')}
						</button>
					{:else if $embedState.status === 'idle' || $embedState.status === 'error'}
						<button
							type="button"
							class="rounded-full border border-primary/40 px-2.5 py-1 text-[11px] font-medium text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/30"
							onclick={onEmbedStart}
						>
							{t('models.download')}
						</button>
					{/if}
					{#if embedActiveOnDisk && $embedState.status !== 'unavailable'}
						<button
							type="button"
							class="rounded-full border border-status-error/40 px-2.5 py-1 text-[11px] font-medium text-status-error outline-none transition-colors hover:bg-status-error/10 focus-visible:ring-2 focus-visible:ring-status-error/30 disabled:opacity-40"
							disabled={embedBusy}
							onclick={() => embedActiveOnDisk && onEmbedDelete(embedActiveOnDisk.id)}
						>
							{embedBusy ? t('models.deleting') : t('models.delete')}
						</button>
					{/if}
				</div>
			</div>
			{#if $embedState.status === 'downloading'}
				<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
					{#if embedFraction == null}
						<div class="h-full w-1/3 animate-pulse rounded-full bg-primary/70"></div>
					{:else}
						<div
							class="h-full rounded-full bg-primary transition-[width] duration-300"
							style={`width: ${Math.round(embedFraction * 100)}%`}
						></div>
					{/if}
				</div>
			{/if}
			{#if $embedState.status === 'error' && $embedState.error}
				<p class="text-status-error select-text text-[11px] leading-snug">{$embedState.error}</p>
			{/if}
		</section>

		<!-- On-device TTS (MOSS-TTS-Nano) — live status + manual download. -->
		<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-1.5">
						<h2 class="truncate text-sm font-semibold tracking-tight">{$ttsState.model}</h2>
						{#each MODALITIES as m (m)}
							<span
								class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
								>{t(`models.modalities.${m}`)}</span
							>
						{/each}
					</div>
					{#if $ttsState.quant}
						<p class="text-muted-foreground mt-1 text-[11px]">{$ttsState.quant}</p>
					{/if}
					{#if ttsActiveOnDisk}
						<p class="text-muted-foreground mt-0.5 font-mono text-[11px]">
							{formatBytes(ttsActiveOnDisk.sizeBytes)}
							{t('models.onDisk')}
						</p>
					{/if}
				</div>
				<div class="flex shrink-0 items-center gap-2">
					<span
						class="text-xs font-medium {ttsStatusKey === 'ready'
							? 'text-status-success'
							: ttsStatusKey === 'error'
								? 'text-status-error'
								: 'text-muted-foreground'}"
					>
						{t(`models.status.${ttsStatusKey}`)}
					</span>
					{#if ttsStatusKey === 'downloading'}
						<button
							type="button"
							class="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground/80 outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary/30"
							onclick={onTtsStop}
						>
							{t('models.stop')}
						</button>
					{:else if ttsStatusKey === 'idle' || ttsStatusKey === 'error'}
						<button
							type="button"
							class="rounded-full border border-primary/40 px-2.5 py-1 text-[11px] font-medium text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/30"
							onclick={onTtsStart}
						>
							{ttsActiveOnDisk ? t('models.load') : t('models.download')}
						</button>
					{/if}
					{#if ttsActiveOnDisk && ttsStatusKey !== 'unavailable'}
						<button
							type="button"
							class="rounded-full border border-status-error/40 px-2.5 py-1 text-[11px] font-medium text-status-error outline-none transition-colors hover:bg-status-error/10 focus-visible:ring-2 focus-visible:ring-status-error/30 disabled:opacity-40"
							disabled={ttsBusyId === ttsActiveOnDisk.id}
							onclick={() => ttsActiveOnDisk && onTtsDelete(ttsActiveOnDisk.id)}
						>
							{ttsBusyId === ttsActiveOnDisk.id ? t('models.deleting') : t('models.delete')}
						</button>
					{/if}
				</div>
			</div>

			{#if ttsStatusKey === 'downloading'}
				<div class="space-y-1.5">
					<div class="flex justify-end">
						<span class="font-mono text-[10px] tabular-nums text-muted-foreground"
							>{formatBytesPair($ttsState.receivedBytes, $ttsState.totalBytes)}</span
						>
					</div>
					<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
						{#if ttsFraction == null}
							<div class="h-full w-1/3 animate-pulse rounded-full bg-primary/70"></div>
						{:else}
							<div
								class="h-full rounded-full bg-primary transition-[width] duration-300"
								style={`width: ${Math.round(ttsFraction * 100)}%`}
							></div>
						{/if}
					</div>
				</div>
			{:else if ttsStatusKey === 'loading'}
				<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div class="h-full w-1/3 animate-pulse rounded-full bg-primary/70"></div>
				</div>
			{/if}

			{#if ttsStatusKey === 'error' && $ttsState.error}
				<p class="text-status-error select-text text-[11px] leading-snug">{$ttsState.error}</p>
			{/if}
			{#if ttsStatusKey === 'unavailable'}
				<p class="text-muted-foreground text-[11px] leading-snug">
					{t('models.secondaryInstance')}
				</p>
			{/if}
		</section>

		<!-- Any other model directories present in the on-device cache. -->
		{#if others.length > 0}
			<section class="space-y-2">
				<h2 class="text-[11px] font-semibold uppercase tracking-wider opacity-70">
					{t('models.title')}
				</h2>
				<ul
					class="divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card/30 divide-y"
				>
					{#each others as m (m.id)}
						<li class="flex items-center justify-between gap-3 px-4 py-3">
							<span class="truncate font-mono text-[12px] select-text">{m.id}</span>
							<div class="flex shrink-0 items-center gap-3">
								<span class="text-muted-foreground font-mono text-[11px]"
									>{formatBytes(m.sizeBytes)}</span
								>
								<button
									type="button"
									class="rounded-full border border-status-error/40 px-2.5 py-1 text-[11px] font-medium text-status-error outline-none transition-colors hover:bg-status-error/10 focus-visible:ring-2 focus-visible:ring-status-error/30 disabled:opacity-40"
									disabled={busyId === m.id}
									onclick={() => onDelete(m.id)}
								>
									{busyId === m.id ? t('models.deleting') : t('models.delete')}
								</button>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if local.length === 0 && statusKey !== 'downloading'}
			<p class="text-muted-foreground text-sm">{t('models.empty')}</p>
		{/if}
	{/if}
</div>
