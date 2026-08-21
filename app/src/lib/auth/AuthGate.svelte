<script lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import { Webview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { openUrl } from '@tauri-apps/plugin-opener'
import { onMount, type Snippet } from 'svelte'
import { goto } from '$app/navigation'

interface BeginAuthorization {
	verificationUriComplete: string
	userCode: string
	expiresIn: number
	interval: number
}

interface PollAuthorization {
	status: 'pending' | 'authenticated'
}

interface AuthStatus {
	authenticated: boolean
}

const { children }: { children: Snippet } = $props()
let ready = $state(!isTauri())
let busy = $state(isTauri())
let message = $state('Anmeldung wird vorbereitet …')
let verificationUrl = $state('')
let userCode = $state('')
let authWebview: Webview | null = null
let pollTimer: ReturnType<typeof setTimeout> | undefined
let unlistenResize: (() => void) | undefined
let mounted = false
let browserOpened = false

async function fitWebview() {
	if (!authWebview) return
	const window = getCurrentWindow()
	const [physical, scale] = await Promise.all([window.innerSize(), window.scaleFactor()])
	const size = physical.toLogical(scale)
	const margin = 16
	const footer = 80
	await Promise.all([
		authWebview.setPosition(new LogicalPosition(margin, margin)),
		authWebview.setSize(
			new LogicalSize(Math.max(320, size.width - margin * 2), Math.max(320, size.height - footer))
		)
	])
}

async function openInBrowser() {
	if (!verificationUrl) return
	await openUrl(verificationUrl)
	browserOpened = true
	message = 'Schließe die Anmeldung im Browser ab — die App macht dann von allein weiter.'
}

async function openEmbedded() {
	const window = getCurrentWindow()
	unlistenResize?.()
	unlistenResize = undefined
	const physical = await window.innerSize()
	const scale = await window.scaleFactor()
	const size = physical.toLogical(scale)
	const margin = 16
	const footer = 80
	const existing = await Webview.getByLabel('aven-auth')
	if (existing) await existing.close()
	authWebview = new Webview(window, 'aven-auth', {
		url: verificationUrl,
		x: margin,
		y: margin,
		width: Math.max(320, size.width - margin * 2),
		height: Math.max(320, size.height - footer),
		focus: true,
		dragDropEnabled: false
	})
	await authWebview.once('tauri://created', () => {
		void authWebview?.setFocus()
	})
	await authWebview.once('tauri://error', () => {
		authWebview = null
		if (!browserOpened) void openInBrowser()
	})
	unlistenResize = await window.onResized(() => void fitWebview())
}

/** Tear down whatever the sign-in attempt is holding, however it ended. */
async function teardown() {
	if (pollTimer) clearTimeout(pollTimer)
	unlistenResize?.()
	unlistenResize = undefined
	if (authWebview) await authWebview.close().catch(() => undefined)
	authWebview = null
	busy = false
}

async function finish() {
	await teardown()
	ready = true
	await goto('/dashboard', { replaceState: true })
}

/**
 * TEMPORARY — the gate shows, it just does not hold the door.
 *
 * The passkey itself is fine; what is not dependable yet is WebAuthn inside
 * the embedded Tauri webview — which is the only path this gate uses, so a
 * failed native prompt would lock the whole desktop app behind a screen with
 * no way past it. (Browser development never reaches here: `ready` starts
 * true when `isTauri()` is false.)
 *
 * Until the native flow is trustworthy you can walk in unauthenticated,
 * deliberately and visibly: sign-in still runs and still wins when it works,
 * but declining it lets you through.
 *
 * This is NOT the intended security model. When the Tauri webview handles
 * passkeys reliably, delete `skip()` and the button that calls it — the gate
 * enforces again with no other change.
 */
async function skip() {
	await teardown()
	message = 'Nicht angemeldet — du nutzt die App ohne Konto.'
	ready = true
}

function schedulePoll(interval: number) {
	pollTimer = setTimeout(async () => {
		if (!mounted) return
		try {
			const result = await invoke<PollAuthorization>('auth_poll')
			if (result.status === 'authenticated') {
				await finish()
				return
			}
			schedulePoll(interval)
		} catch (cause) {
			busy = false
			message = cause instanceof Error ? cause.message : String(cause)
		}
	}, interval * 1000)
}

async function begin() {
	busy = true
	message = 'Anmeldung wird vorbereitet …'
	browserOpened = false
	try {
		const authorization = await invoke<BeginAuthorization>('auth_begin')
		verificationUrl = authorization.verificationUriComplete
		userCode = authorization.userCode.replace(/(.{4})(?=.)/g, '$1-')
		message = 'Melde dich mit deinem Passkey an und bestätige dieses Gerät.'
		try {
			await openEmbedded()
		} catch {
			await openInBrowser()
		}
		schedulePoll(Math.max(authorization.interval, 1))
	} catch (cause) {
		busy = false
		message = cause instanceof Error ? cause.message : String(cause)
	}
}

onMount(() => {
	mounted = true
	if (!isTauri()) return
	void (async () => {
		try {
			const status = await invoke<AuthStatus>('auth_status')
			if (status.authenticated) await finish()
			else await begin()
		} catch (cause) {
			busy = false
			message = cause instanceof Error ? cause.message : String(cause)
		}
	})()
	return () => {
		mounted = false
		if (pollTimer) clearTimeout(pollTimer)
		unlistenResize?.()
		if (authWebview) void authWebview.close().catch(() => undefined)
	}
})
</script>

{#if ready}
	{@render children()}
{:else}
	<!-- The gate is the first thing anyone sees of avenOS, so it wears the
	     brand rather than raw slate: the cream ground, the marine ink, and the
	     one card idiom the rest of the app uses. -->
	<main class="fixed inset-0 grid place-items-center bg-surface-cream p-6 text-foreground">
		<section class="w-full max-w-md text-center" aria-live="polite">
			<img src="/aven-logo.svg" alt="" class="mx-auto size-14" width="56" height="56">
			<h1 class="mt-6 font-semibold text-foreground text-xl tracking-tight">Willkommen zurück</h1>
			<p class="mx-auto mt-2 max-w-sm text-foreground/60 text-sm leading-relaxed">{message}</p>

			{#if userCode}
				<div
					class="mt-6 rounded-2xl border border-foreground/5 bg-surface-raised p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
				>
					<p class="font-semibold text-[10px] text-foreground/45 uppercase tracking-[0.14em]">
						Gerätecode
					</p>
					<p class="mt-2 font-mono font-semibold text-2xl text-foreground tracking-[0.18em]">
						{userCode}
					</p>
				</div>
			{/if}

			<div class="mt-6 flex justify-center gap-3">
				{#if verificationUrl}
					<button
						type="button"
						class="min-h-11 rounded-full border border-border px-6 font-medium text-foreground text-sm transition-colors hover:bg-surface-soft"
						onclick={openInBrowser}
					>
						Im Browser öffnen
					</button>
				{/if}
				{#if !busy}
					<button
						type="button"
						class="min-h-11 rounded-full bg-primary px-6 font-semibold text-primary-foreground text-sm transition-opacity hover:opacity-90"
						onclick={begin}
					>
						Erneut versuchen
					</button>
				{/if}
			</div>
		</section>

		<!-- Temporary: see `skip()`. Lives in the footer strip the auth webview
		     leaves free, so it stays clickable while sign-in is on screen.
		     Goes away when passkeys are dependable. -->
		<div
			class="fixed inset-x-0 bottom-0 flex h-20 items-center justify-center gap-4 border-border/60 border-t bg-surface-cream px-6"
		>
			<p class="text-foreground/45 text-xs">
				Anmeldung ist noch nicht verpflichtend — Passkeys im Desktop‑Webview sind noch in Arbeit.
			</p>
			<button
				type="button"
				class="min-h-9 shrink-0 rounded-full border border-border px-4 font-medium text-foreground/70 text-xs transition-colors hover:bg-surface-soft"
				onclick={skip}
			>
				Ohne Anmeldung fortfahren
			</button>
		</div>
	</main>
{/if}
