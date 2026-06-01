<script lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { onDestroy, onMount } from 'svelte'
import { t } from '$lib/i18n'
import { openpty } from 'xterm-pty'
import { startWebcmWithPty } from './webcm-worker'
import '@xterm/xterm/css/xterm.css'

const webcmBase =
	(import.meta.env.PUBLIC_WEBCM_BASE as string | undefined)?.replace(/\/$/, '') ?? '/webcm'

let host = $state<HTMLDivElement | null>(null)
let overlay = $state<'idle' | 'booting' | 'error'>('idle')
let overlayMsg = $state('')

let term: Terminal | null = null
let fit: FitAddon | null = null
let ro: ResizeObserver | null = null
let cancelled = false

onMount(() => {
	void mountTerminal()
})

onDestroy(() => {
	cancelled = true
	ro?.disconnect()
	ro = null
	term?.dispose()
	term = null
	fit = null
})

async function mountTerminal() {
	if (!host || cancelled) return
	overlay = 'booting'
	overlayMsg = t('sandbox.preparingTerminal')

	try {
		term = new Terminal({
			fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
			fontSize: 14,
			lineHeight: 1.2,
			cursorBlink: true,
			convertEol: true,
			theme: {
				background: '#000000',
				foreground: '#f3f3f3'
			}
		})
		fit = new FitAddon()
		term.loadAddon(fit)
		term.loadAddon(new WebLinksAddon())
		term.open(host)
		fit.fit()

		const { master, slave } = openpty()

		// Raw/cbreak-style line discipline (matches upstream webcm index.html)
		const termios = slave.ioctl('TCGETS') as {
			iflag: number
			oflag: number
			cflag: number
			lflag: number
			cc: readonly number[] | number[]
		}
		termios.iflag &= ~0x5eb
		termios.cflag &= ~0x130
		termios.lflag &= ~0x804b
		termios.cflag |= 0x30
		termios.oflag |= 0x1
		slave.ioctl('TCSETS', termios)

		term.loadAddon(master)
		term.focus()

		term.writeln(`\x1b[33m${t('sandbox.bootingWebcm')}\x1b[0m\r\n`)

		const mjsUrl = `${webcmBase}/webcm.mjs`

		ro = new ResizeObserver(() => {
			fit?.fit()
		})
		ro.observe(host)

		overlay = 'idle'

		// initEmscripten typically does not resolve until the guest exits; errors still reject.
		await startWebcmWithPty(slave, mjsUrl)
	} catch (e) {
		if (cancelled) return
		overlay = 'error'
		overlayMsg = e instanceof Error ? e.message : String(e)
		term?.writeln(`\r\n\x1b[31m${overlayMsg}\x1b[0m\r\n`)
		term?.writeln(
			`\x1b[90m${t('sandbox.fetchWebcmHint')}\x1b[0m\r\n`,
		)
	}
}
</script>

<div class="relative box-border h-full min-h-0 w-full min-w-0 p-1">
	<div
		bind:this={host}
		class="box-border h-full min-h-0 w-full min-w-0"
		aria-label={t('sandbox.terminalAria')}
	></div>
	{#if overlay === 'booting' && host}
		<div
			class="pointer-events-none absolute inset-0 flex items-center justify-center rounded border border-white/10 bg-black/50 text-xs text-white/60"
		>
			{overlayMsg}
		</div>
	{/if}
	{#if overlay === 'error'}
		<div
			class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 px-4 text-center text-xs text-red-200"
		>
			<p class="font-semibold">{t('sandbox.failedToStart')}</p>
			<p class="max-w-md text-white/70">{overlayMsg}</p>
			<p class="text-white/50">
				{t('sandbox.crossOriginLabel')}
				{typeof crossOriginIsolated !== 'undefined' &&
				crossOriginIsolated === true
					? t('sandbox.crossOriginYes')
					: t('sandbox.crossOriginNo')}
			</p>
		</div>
	{/if}
</div>
