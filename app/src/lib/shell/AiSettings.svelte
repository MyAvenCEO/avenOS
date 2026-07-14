<script lang="ts">
import {
	DEFAULT_VOICE_MODE,
	setVoiceMode,
	type VoiceMode,
	voiceMode
} from '$lib/settings/voice-mode-store'

// Account → AI (board 0120): pick the voice pipeline the main voice interaction uses.
// Realtime (default) runs all three stages inside the Tinfoil enclave; On-device is the local
// Parakeet → LFM2 → MOSS chain (offline / no-account fallback).
const options: { id: VoiceMode; label: string; detail: string }[] = [
	{
		id: 'realtime',
		label: 'Realtime live voice',
		detail:
			'Lowest latency. Voxtral realtime STT → fast LLM → Voxtral TTS, all inside the Tinfoil enclave. Needs an account + network.'
	},
	{
		id: 'on-device',
		label: 'On-device (Parakeet)',
		detail: 'Fully local. Parakeet transcription on this device — works offline, no account.'
	}
]
</script>

<div class="mx-auto flex w-full max-w-xl flex-col gap-4 p-6">
	<h2 class="text-foreground text-base font-semibold">AI</h2>

	<div class="flex flex-col gap-2">
		<span class="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
			Voice mode
		</span>
		<p class="text-muted-foreground text-[12px]">
			Default is <span class="text-foreground">Realtime live voice</span>.
		</p>
		<div class="flex flex-col gap-2">
			{#each options as opt (opt.id)}
				<button
					type="button"
					aria-pressed={$voiceMode === opt.id}
					class="flex flex-col gap-1 rounded-[var(--radius)] border px-3 py-2.5 text-left transition-colors {$voiceMode ===
					opt.id
						? 'border-primary bg-primary/10'
						: 'border-border hover:bg-card'}"
					onclick={() => setVoiceMode(opt.id)}
				>
					<span class="text-foreground flex items-center gap-2 text-[13px] font-medium">
						{opt.label}
						{#if opt.id === DEFAULT_VOICE_MODE}
							<span class="text-muted-foreground text-[10px] font-normal tracking-wide uppercase">
								Default
							</span>
						{/if}
					</span>
					<span class="text-muted-foreground text-[12px]">{opt.detail}</span>
				</button>
			{/each}
		</div>
	</div>
</div>
