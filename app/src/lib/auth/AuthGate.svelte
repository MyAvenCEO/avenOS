<script lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
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

interface BeginPasskeyAuthentication {
	available: boolean
	command: string
	rpId: string
	challenge: number[]
}

interface NativePasskeyAssertion {
	id: string
	raw_id: string
	client_data_json: string
	authenticator_data: string
	signature: string
	user_handle: string
}

const { children }: { children: Snippet } = $props()
let ready = $state(!isTauri())
let busy = $state(isTauri())
let message = $state('Sichere Anmeldung wird vorbereitet …')
let verificationUrl = $state('')
let userCode = $state('')
let pollTimer: ReturnType<typeof setTimeout> | undefined
let mounted = false

async function openInBrowser() {
	if (!verificationUrl) return
	await openUrl(verificationUrl)
	message = 'Schließe die sichere Anmeldung im Browser ab. avenOS kann geöffnet bleiben.'
}

async function finish() {
	if (pollTimer) clearTimeout(pollTimer)
	ready = true
	busy = false
	await goto('/dashboard', { replaceState: true })
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

async function beginWeb() {
	busy = true
	message = 'Browser-Anmeldung wird vorbereitet …'
	verificationUrl = ''
	userCode = ''
	if (pollTimer) clearTimeout(pollTimer)
	try {
		const authorization = await invoke<BeginAuthorization>('auth_begin')
		verificationUrl = authorization.verificationUriComplete
		userCode = authorization.userCode.replace(/(.{4})(?=.)/g, '$1-')
		await openInBrowser()
		schedulePoll(Math.max(authorization.interval, 1))
	} catch (cause) {
		busy = false
		message = cause instanceof Error ? cause.message : String(cause)
	}
}

async function begin() {
	busy = true
	message = 'Dein Aven-Passkey wird gesucht …'
	try {
		const request = await invoke<BeginPasskeyAuthentication>('auth_passkey_begin')
		if (!request.available) {
			await beginWeb()
			return
		}
		message = 'Verwende deinen systemverwalteten Aven-Passkey, um fortzufahren.'
		const assertion = await invoke<NativePasskeyAssertion>(request.command, {
			domain: request.rpId,
			challenge: request.challenge,
			salt: []
		})
		await invoke<AuthStatus>('auth_passkey_finish', { assertion })
		await finish()
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : String(cause)
		if (detail.includes('NATIVE_PASSKEY_UNAVAILABLE')) {
			await beginWeb()
			return
		}
		busy = false
		message = detail
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
	}
})
</script>

{#if ready}
	{@render children()}
{:else}
	<main class="fixed inset-0 overflow-hidden bg-surface-cream text-foreground">
		<div
			class="-right-32 -top-40 pointer-events-none absolute size-[34rem] rounded-full bg-status-pairing/12 blur-3xl"
		></div>
		<div
			class="-bottom-48 -left-32 pointer-events-none absolute size-[32rem] rounded-full bg-status-info/14 blur-3xl"
		></div>

		<header class="absolute inset-x-0 top-0 flex items-center justify-between px-8 py-7">
			<p class="avenos-wordmark !text-[1.7rem] text-primary">
				<span class="wm-aven">aven</span><span class="wm-os">OS</span>
			</p>
			<div class="flex items-center gap-2 text-foreground/55 text-xs">
				<svg
					viewBox="0 0 24 24"
					class="size-3.5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
				>
					<rect x="5" y="10" width="14" height="10" rx="2" />
					<path d="M8 10V7a4 4 0 0 1 8 0v3" />
				</svg>
				<span>id.next.aven.ceo</span>
			</div>
		</header>

		<div class="relative grid min-h-dvh place-items-center px-6 py-24">
			<section
				class="w-full max-w-md rounded-[2rem] border border-primary/10 bg-white/72 p-8 text-center shadow-[0_30px_90px_rgba(30,41,59,0.12)] backdrop-blur-xl sm:p-10"
				aria-live="polite"
			>
				<div
					class="mx-auto mb-7 grid size-16 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/15"
				>
					{#if busy}
						<svg viewBox="0 0 24 24" class="size-7 animate-spin" fill="none">
							<circle
								cx="12"
								cy="12"
								r="9"
								stroke="currentColor"
								stroke-opacity=".25"
								stroke-width="1.8"
							/>
							<path
								d="M12 3a9 9 0 0 1 9 9"
								stroke="currentColor"
								stroke-linecap="round"
								stroke-width="1.8"
							/>
						</svg>
					{:else}
						<svg
							viewBox="0 0 24 24"
							class="size-7"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.6"
						>
							<path d="M14.5 5.5a4.5 4.5 0 1 0-3.2 7.7L14 16h2v2h2v2h3v-3l-6.3-6.3" />
							<circle cx="10" cy="10" r=".7" fill="currentColor" stroke="none" />
						</svg>
					{/if}
				</div>

				<p class="mb-3 font-medium text-primary/55 text-xs uppercase tracking-[0.18em]">
					{verificationUrl ? 'Browser-Anmeldung' : 'Sicherer Zugang'}
				</p>
				<h1 class="font-display font-semibold text-3xl tracking-tight">
					{verificationUrl ? 'Im Browser fortfahren' : 'Willkommen bei avenOS'}
				</h1>
				<p class="mx-auto mt-4 max-w-sm text-foreground/65 text-sm leading-6">{message}</p>

				{#if userCode}
					<div class="mt-7 rounded-2xl border border-primary/10 bg-surface-card/70 px-5 py-4">
						<p class="mb-1.5 text-foreground/45 text-[0.68rem] uppercase tracking-[0.17em]">
							Gerätecode
						</p>
						<p class="font-mono font-semibold text-primary text-xl tracking-[0.2em]">{userCode}</p>
					</div>
				{/if}

				<div class="mt-7 grid gap-3">
					{#if verificationUrl}
						<button
							type="button"
							class="min-h-12 rounded-xl bg-primary px-5 font-medium text-primary-foreground text-sm shadow-lg shadow-primary/10 transition hover:bg-primary/90"
							onclick={openInBrowser}
						>
							Sichere Anmeldung öffnen
						</button>
					{/if}
					{#if !busy}
						<button
							type="button"
							class="min-h-12 rounded-xl border border-primary/15 bg-white/60 px-5 font-medium text-primary text-sm transition hover:bg-surface-card"
							onclick={begin}
						>
							Erneut versuchen
						</button>
					{/if}
				</div>

				<p class="mt-7 flex items-center justify-center gap-2 text-foreground/40 text-xs">
					<span class="size-1.5 rounded-full bg-status-success"></span>
					Passkey und Sitzung bleiben durch dein Gerät geschützt
				</p>
			</section>
		</div>
	</main>
{/if}
