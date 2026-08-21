<script lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { settings, VOICES, type Voice } from '$lib/settings.svelte'
import BrandColors from './BrandColors.svelte'

/**
 * Settings — today, one decision: which voice speaks.
 *
 * Ten Supertonic voices, M1–M5 and F1–F5. Selecting applies from the very
 * next spoken sentence (the speaker reads the setting per synthesis call);
 * the play button says a sample sentence in that voice, since a voice can
 * only be chosen by ear.
 */

/** Settings has categories now — one surface per concern, chosen on the left. */
const CATEGORIES = [
	{ id: 'general' as const, label: 'Allgemein' },
	{ id: 'voice' as const, label: 'Stimme' },
	{ id: 'colors' as const, label: 'Brand-Farben' }
]
let category = $state<'general' | 'voice' | 'colors'>('general')

/** The voice currently sounding a preview, if any. */
let playing = $state<Voice | null>(null)
let failure = $state<string | null>(null)

const SAMPLE = 'Hallo, ich bin deine Stimme. Milch und Brot stehen auf der Liste.'

let context: AudioContext | null = null

async function preview(voice: Voice) {
	if (playing) return
	playing = voice
	failure = null
	try {
		const wav = await invoke<ArrayBuffer>('tts_speak', {
			text: SAMPLE,
			lang: 'de',
			voice
		})
		context ??= new AudioContext()
		if (context.state === 'suspended') await context.resume()
		const buffer = await context.decodeAudioData(wav)
		const source = context.createBufferSource()
		source.buffer = buffer
		source.connect(context.destination)
		await new Promise<void>((resolve) => {
			source.onended = () => resolve()
			source.start()
		})
	} catch (err) {
		failure = err instanceof Error ? err.message : String(err)
	} finally {
		playing = null
	}
}
</script>

<svelte:head>
	<title>Settings · avenOS</title>
</svelte:head>

<main class="mx-auto flex min-h-0 min-w-0 max-w-5xl flex-1 flex-col gap-6 p-4 sm:p-6">
	<header class="relative flex flex-col items-center gap-1.5">
		<!-- The same quiet route stamp the dashboard wears. -->
		<p class="text-[0.625rem] uppercase tracking-[0.2em] opacity-35">Settings</p>
		<a
			href="/dashboard"
			class="absolute right-0 top-0 text-xs underline underline-offset-4 opacity-50"
		>
			Back
		</a>
	</header>

	<div class="flex min-h-0 flex-1 gap-6">
		<!-- The categories: one concern per surface. -->
		<nav class="flex w-44 shrink-0 flex-col gap-1">
			{#each CATEGORIES as c (c.id)}
				<button
					type="button"
					onclick={() => {
						category = c.id
					}}
					class="rounded-xl px-3 py-2 text-left text-sm transition-colors {category === c.id
						? 'border border-foreground/5 bg-[#fffdf7] font-medium shadow-[0_1px_3px_rgba(30,41,59,0.05)]'
						: 'opacity-60 hover:opacity-100'}"
				>
					{c.label}
				</button>
			{/each}
		</nav>

		<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto pb-4">
			{#if category === 'colors'}
				<BrandColors />
			{:else if category === 'voice'}
				<section class="flex min-h-0 flex-col gap-3">
					<div class="flex items-baseline justify-between">
						<h2 class="text-sm">Voice</h2>
						<span class="text-xs opacity-40">applies from the next sentence</span>
					</div>

					{#if !isTauri()}
						<p
							class="rounded-xl border border-foreground/5 bg-[#fffdf7] px-4 py-3 text-xs opacity-60 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
						>
							The voice only runs in the app — there is nothing to hear in the browser.
						</p>
					{/if}

					<ul class="min-h-0 flex-1 space-y-1 overflow-y-auto">
						{#each VOICES as voice (voice)}
							<li
								class="group flex items-center gap-3 rounded-xl border px-3 py-2 text-sm shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-colors {settings.voice ===
							voice
								? 'border-primary bg-[#fffdf7]'
								: 'border-foreground/5 bg-[#fffdf7]'}"
							>
								<button
									type="button"
									onclick={() => {
									settings.voice = voice
								}}
									class="flex flex-1 items-center gap-3 text-left"
								>
									<!-- Radio dot, drawn rather than native, so it matches the list. -->
									<span
										class="flex size-4 shrink-0 items-center justify-center rounded-full border {settings.voice ===
									voice
										? 'border-primary'
										: 'border-border'}"
									>
										{#if settings.voice === voice}
											<span class="size-2 rounded-full bg-primary"></span>
										{/if}
									</span>
									<span class="flex-1">
										{voice.startsWith('M') ? 'Male' : 'Female'}
										{voice.slice(1)}
										<span class="pl-1 font-mono text-xs opacity-40">{voice}</span>
									</span>
								</button>

								{#if isTauri()}
									<button
										type="button"
										onclick={() => preview(voice)}
										disabled={playing !== null}
										title="Play"
										aria-label="Play voice {voice}"
										class="shrink-0 rounded-full border border-border p-2 transition-colors hover:bg-primary/5 disabled:opacity-30"
									>
										{#if playing === voice}
											<!-- sounding: a small filled square, same as stop elsewhere -->
											<svg viewBox="0 0 24 24" class="size-3.5" fill="currentColor">
												<rect x="7" y="7" width="10" height="10" rx="1.5" />
											</svg>
										{:else}
											<!-- play -->
											<svg viewBox="0 0 24 24" class="size-3.5" fill="currentColor">
												<path d="M8 5.5v13l11-6.5z" />
											</svg>
										{/if}
									</button>
								{/if}
							</li>
						{/each}
					</ul>

					{#if failure}
						<p
							class="rounded-xl border border-status-error/30 bg-status-error-muted px-4 py-3 text-xs text-status-error-strong"
						>
							{failure}
						</p>
					{/if}
				</section>
			{:else}
				<!-- The brain, named here rather than in the app chrome: which model answers
			     is configuration, not something to stare at all day. -->
				<section class="flex flex-col gap-3">
					<h2 class="text-sm">Model</h2>
					<p
						class="rounded-xl border border-foreground/5 bg-[#fffdf7] px-4 py-3 font-mono text-xs opacity-70 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
					>
						qwen/qwen3.5-122b-a10b · RedPill TEE
					</p>
				</section>
			{/if}
		</div>
	</div>
</main>
