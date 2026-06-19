<script lang="ts">
import { AUTH_BASE_URL, authClient } from '$lib/auth/auth-client'
import { t } from '$lib/i18n'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { clearNetwork } from '$lib/settings/network-store'

// Protected-screen gate for mainnet/alberobello: no session ⇒ Continue with Google;
// session ⇒ render the slotted children (the mocked chat). board 0050.
let { children } = $props()

const session = authClient.useSession()

let signingIn = $state(false)
let error = $state<string | null>(null)
// TEMP diagnostic (board 0050): the raw baked env + the resolved base + a live connectivity
// probe, surfaced in the UI so a shipped build can be debugged without devtools.
const bakedEnv = (import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined) ?? 'UNSET'
let diag = $state<string | null>(null)

async function probe(): Promise<string> {
	try {
		const r = await fetch(`${AUTH_BASE_URL}/api/auth/get-session`, { method: 'GET' })
		return `probe ${AUTH_BASE_URL} → HTTP ${r.status}`
	} catch (e) {
		return `probe ${AUTH_BASE_URL} → ${e instanceof Error ? e.message : String(e)}`
	}
}

/**
 * Desktop (Tauri): Google blocks OAuth inside the embedded WebView, so we use the
 * native plugin (system browser + local redirect) to get a Google idToken, then hand it
 * to Better Auth's idToken sign-in. The client id/secret come from a Tauri command that
 * reads the Rust process env — never bundled into the frontend. On success the bearer
 * token is captured by the auth client; reload re-runs the session check and opens the gate.
 */
async function signInTauri(): Promise<void> {
	const { invoke } = await import('@tauri-apps/api/core')
	const cfg = await invoke<{ client_id: string; client_secret: string }>('google_oauth_config')
	const { signIn: nativeGoogleSignIn } = await import('@choochmeque/tauri-plugin-google-auth-api')
	const res = await nativeGoogleSignIn({
		clientId: cfg.client_id,
		clientSecret: cfg.client_secret,
		scopes: ['openid', 'email', 'profile']
	})
	if (!res.idToken) throw new Error('Google did not return an idToken')
	const out = await authClient.signIn.social({
		provider: 'google',
		idToken: { token: res.idToken, accessToken: res.accessToken }
	})
	if (out.error) throw new Error(out.error.message ?? 'sign-in failed')
	window.location.reload()
}

/** Web: standard Better Auth redirect flow (works in a real browser). */
async function signInWeb(): Promise<void> {
	await authClient.signIn.social({ provider: 'google', callbackURL: window.location.href })
}

async function continueWithGoogle(): Promise<void> {
	signingIn = true
	error = null
	try {
		if (isTauriRuntime()) await signInTauri()
		else await signInWeb()
	} catch (e) {
		signingIn = false
		error = e instanceof Error ? e.message : String(e)
		diag = `baked=${bakedEnv} · ${await probe()}`
	}
}
</script>

{#if $session.isPending}
	<div class="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
		<p class="text-muted-foreground text-sm">{t('mainnet.auth.loading')}</p>
	</div>
{:else if $session.data}
	{@render children()}
{:else}
	<div class="flex min-h-0 flex-1 flex-col items-center justify-center bg-background p-6">
		<div
			class="border-border bg-card w-full max-w-sm rounded-[var(--radius-lg)] border p-6 text-center"
		>
			<p class="text-primary text-[10px] font-bold tracking-[0.18em] uppercase">
				{t('mainnet.auth.tag')}
			</p>
			<h1 class="font-display mt-2 text-xl font-medium tracking-tight">
				{t('mainnet.auth.title')}
			</h1>
			<p class="text-muted-foreground mt-2 text-sm leading-relaxed">
				{t('mainnet.auth.subtitle')}
			</p>
			<button
				type="button"
				class="bg-primary text-primary-foreground hover:bg-primary/90 mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
				onclick={continueWithGoogle}
				disabled={signingIn}
			>
				<svg class="size-4" viewBox="0 0 24 24" aria-hidden="true">
					<path
						fill="currentColor"
						d="M21.35 11.1H12v2.92h5.35a4.58 4.58 0 0 1-1.98 3.01v2.5h3.2c1.87-1.72 2.95-4.26 2.95-7.28 0-.69-.07-1.36-.17-2.01Z"
					/>
					<path
						fill="currentColor"
						d="M12 22c2.67 0 4.9-.88 6.54-2.39l-3.2-2.5c-.89.6-2.03.95-3.34.95-2.57 0-4.75-1.74-5.53-4.07H3.18v2.56A9.99 9.99 0 0 0 12 22Z"
						opacity="0.85"
					/>
					<path
						fill="currentColor"
						d="M6.47 13.99A6 6 0 0 1 6.15 12c0-.69.12-1.36.32-1.99V7.45H3.18A9.99 9.99 0 0 0 2 12c0 1.61.39 3.14 1.18 4.55l3.29-2.56Z"
						opacity="0.7"
					/>
					<path
						fill="currentColor"
						d="M12 5.94c1.45 0 2.76.5 3.79 1.48l2.84-2.84C16.9 2.99 14.67 2 12 2 8.1 2 4.74 4.24 3.18 7.45l3.29 2.56C7.25 7.68 9.43 5.94 12 5.94Z"
						opacity="0.55"
					/>
				</svg>
				{signingIn ? t('mainnet.auth.signingIn') : t('mainnet.auth.continueGoogle')}
			</button>
			{#if error}
				<p class="text-destructive mt-3 text-xs">{error}</p>
			{/if}
			{#if diag}
				<p class="text-muted-foreground mt-2 text-[10px] break-all">{diag}</p>
			{/if}
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground mt-4 text-[11px] font-semibold underline-offset-2 hover:underline"
				onclick={() => clearNetwork()}
			>
				← {t('networkSelect.kicker')}
			</button>
		</div>
	</div>
{/if}
