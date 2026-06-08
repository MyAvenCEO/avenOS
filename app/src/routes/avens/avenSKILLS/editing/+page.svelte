<script lang="ts">
	import { onMount } from 'svelte'
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'

	type Clip = {
		id: string
		title: string
		src: string
		html?: string
		script?: string
		durationSec?: number | null
	}

	let clips = $state<Clip[]>([])
	let loaded = $state(false)
	let loadError = $state<string | null>(null)
	let selectedId = $state<string | null>(null)

	const selected = $derived(clips.find((c) => c.id === selectedId) ?? clips[0] ?? null)

	async function loadManifest(): Promise<void> {
		try {
			const res = await fetch('/skills/editing/manifest.json', { cache: 'no-store' })
			if (res.status === 404) {
				clips = []
				return
			}
			if (!res.ok) throw new Error(`manifest ${res.status}`)
			const data = (await res.json()) as Clip[]
			clips = Array.isArray(data) ? data : []
			if (clips.length && !selectedId) selectedId = clips[0].id
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e)
		} finally {
			loaded = true
		}
	}

	onMount(() => {
		if (browser) void loadManifest()
	})

	function fmtDuration(sec?: number | null): string {
		if (!sec && sec !== 0) return ''
		return `${Number(sec).toFixed(sec % 1 === 0 ? 0 : 1)}s`
	}
</script>

<svelte:head>
	<title>{t('editor.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pt-4 pb-8 sm:px-6 md:px-8">
	<header class="space-y-1">
		<h1 class="text-xl font-semibold tracking-tight">{t('editor.title')}</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">{t('editor.subtitle')}</p>
	</header>

	{#if !loaded}
		<p class="text-muted-foreground text-sm">{t('editor.loading')}</p>
	{:else if loadError}
		<p
			class="text-destructive border-destructive/40 bg-destructive/10 rounded-lg border px-3 py-2 text-sm leading-snug"
			role="alert"
		>
			{loadError}
		</p>
	{:else if clips.length === 0}
		<div class="border-border/60 text-muted-foreground rounded-xl border px-4 py-10 text-center text-sm">
			<p>{t('editor.empty')}</p>
			<p class="mt-2 font-mono text-[11px]">{t('editor.emptyHint')}</p>
		</div>
	{:else}
		<div class="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
			<!-- clip list -->
			<ul class="flex flex-col gap-1.5" aria-label={t('editor.clipList')}>
				{#each clips as clip (clip.id)}
					<li>
						<button
							type="button"
							class="border-input hover:bg-accent hover:text-accent-foreground flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors {selected?.id ===
							clip.id
								? 'bg-accent text-accent-foreground border-border'
								: 'bg-card/40'}"
							onclick={() => (selectedId = clip.id)}
						>
							<span class="text-sm font-medium tracking-tight">{clip.title}</span>
							<span class="text-muted-foreground text-[11px]">
								{clip.id}{clip.durationSec != null ? ` · ${fmtDuration(clip.durationSec)}` : ''}
							</span>
						</button>
					</li>
				{/each}
			</ul>

			<!-- player + script -->
			{#if selected}
				<div class="flex min-w-0 flex-col gap-4">
					<div class="border-border/60 bg-black overflow-hidden rounded-xl border">
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							src={selected.src}
							controls
							playsinline
							class="aspect-video w-full bg-black"
						></video>
					</div>

					<div class="flex flex-wrap items-center gap-3">
						<h2 class="text-base font-semibold tracking-tight">{selected.title}</h2>
						{#if selected.html}
							<a
								href={selected.html}
								target="_blank"
								rel="noopener"
								class="text-muted-foreground hover:text-foreground text-[11px] font-medium underline"
							>
								{t('editor.viewSource')}
							</a>
						{/if}
					</div>

					{#if selected.script}
						<section class="space-y-1.5">
							<h3
								class="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide"
							>
								{t('editor.script')}
							</h3>
							<pre
								class="border-border/60 bg-muted/30 text-foreground/90 max-h-80 overflow-auto rounded-lg border px-3 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{selected.script}</pre>
						</section>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
