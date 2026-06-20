<script lang="ts">
// Dev diagnostic (board 0055): does THIS WKWebView expose WebAuthn + the PRF extension?
// It decides Route A (Better Auth passkey client end-to-end, key derived in-webview) vs
// Route B (native tauri-plugin-passkey). rp.id MUST equal the app's `webcredentials:`
// associated-domain — NOT the tauri:// page origin — or you get a false negative.

type Line = { level: 'info' | 'ok' | 'warn' | 'err'; text: string }

let rpId = $state('maia.city')
let running = $state(false)
let lines = $state<Line[]>([])
let verdict = $state<{ route: 'A' | 'B'; text: string } | null>(null)
let createdId = $state<ArrayBuffer | null>(null)

function log(level: Line['level'], text: string): void {
	lines = [...lines, { level, text }]
}

function toHex(buf: ArrayBuffer): string {
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function runCreate(): Promise<void> {
	lines = []
	verdict = null
	createdId = null
	running = true
	try {
		log('info', `origin ${location.origin}  ·  rp.id ${rpId}`)

		const hasApi =
			typeof PublicKeyCredential !== 'undefined' &&
			typeof navigator.credentials?.create === 'function'
		log(hasApi ? 'ok' : 'err', `WebAuthn API present: ${hasApi}`)
		if (!hasApi) {
			verdict = { route: 'B', text: 'navigator.credentials missing in this WKWebView.' }
			return
		}

		try {
			const uvpaa = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
			log(uvpaa ? 'ok' : 'warn', `Platform authenticator available: ${uvpaa}`)
		} catch (e) {
			log('warn', `UVPAA check threw: ${(e as Error).message}`)
		}

		const cred = (await navigator.credentials.create({
			publicKey: {
				challenge: crypto.getRandomValues(new Uint8Array(32)),
				rp: { id: rpId, name: 'avenOS' },
				user: {
					id: crypto.getRandomValues(new Uint8Array(16)),
					name: 'prf-probe',
					displayName: 'PRF probe'
				},
				pubKeyCredParams: [
					{ type: 'public-key', alg: -7 },
					{ type: 'public-key', alg: -257 }
				],
				authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
				extensions: { prf: {} } as AuthenticationExtensionsClientInputs
			}
		})) as PublicKeyCredential | null

		if (!cred) {
			log('err', 'create() returned null')
			verdict = { route: 'B', text: 'No credential returned.' }
			return
		}
		log('ok', 'create() ceremony completed')
		createdId = cred.rawId

		const ext = cred.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & {
			prf?: { enabled?: boolean }
		}
		log('info', `clientExtensionResults.prf: ${JSON.stringify(ext.prf ?? null)}`)

		if (ext.prf?.enabled) {
			verdict = { route: 'A', text: 'WKWebView does WebAuthn + PRF — derive the vault key in-webview.' }
			log('ok', '✅ PRF enabled. Click "Derive PRF value" to confirm real key material.')
		} else {
			verdict = { route: 'B', text: 'Ceremony works but PRF is not enabled here.' }
			log('warn', '⚠️ PRF not enabled on this authenticator/webview.')
		}
	} catch (e) {
		const err = e as Error
		log('err', `create() failed: ${err.name} — ${err.message}`)
		verdict = {
			route: 'B',
			text:
				err.name === 'SecurityError'
					? 'SecurityError usually means rp.id is not allowed for this origin/entitlement — fix rp.id and retry.'
					: 'create() failed in this webview.'
		}
	} finally {
		running = false
	}
}

async function runGet(): Promise<void> {
	if (!createdId) return
	running = true
	try {
		const salt = crypto.getRandomValues(new Uint8Array(32))
		const assertion = (await navigator.credentials.get({
			publicKey: {
				challenge: crypto.getRandomValues(new Uint8Array(32)),
				rpId,
				allowCredentials: [{ id: createdId, type: 'public-key' }],
				userVerification: 'required',
				extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs
			}
		})) as PublicKeyCredential | null

		const ext = assertion?.getClientExtensionResults() as
			| (AuthenticationExtensionsClientOutputs & { prf?: { results?: { first?: ArrayBuffer } } })
			| undefined
		const first = ext?.prf?.results?.first
		if (first) {
			log('ok', `🔑 PRF output (${new Uint8Array(first).length}B): ${toHex(first)}`)
			log('ok', 'Deterministic key material confirmed — envelope-encrypt the vault with this.')
		} else {
			log('warn', `No prf.results.first returned: ${JSON.stringify(ext?.prf ?? null)}`)
		}
	} catch (e) {
		log('err', `get() failed: ${(e as Error).name} — ${(e as Error).message}`)
	} finally {
		running = false
	}
}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
	<div class="mx-auto flex w-full max-w-2xl flex-col gap-4">
		<header class="flex flex-col gap-1">
			<h2 class="text-foreground text-base font-semibold">Passkey PRF probe</h2>
			<p class="text-muted-foreground text-[13px] leading-relaxed">
				Go/no-go for Route A (board 0055): does this webview expose WebAuthn + the PRF extension?
				Registers a throwaway passkey — expect a Touch&nbsp;ID prompt. Delete it afterward in System
				Settings → Passwords.
			</p>
		</header>

		<label class="flex flex-col gap-1">
			<span class="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
				rp.id — must match your webcredentials: entitlement domain
			</span>
			<input
				class="border-border bg-card text-foreground rounded-[var(--radius)] border px-3 py-1.5 text-[13px]"
				bind:value={rpId}
				placeholder="maia.city"
				autocapitalize="off"
				autocorrect="off"
				spellcheck="false"
			/>
		</label>

		<div class="flex items-center gap-2">
			<button
				type="button"
				disabled={running || !rpId}
				class="bg-primary text-primary-foreground rounded-[var(--radius)] px-3 py-1.5 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
				onclick={() => void runCreate()}
			>
				{running ? 'Running…' : 'Run probe (create)'}
			</button>
			{#if createdId}
				<button
					type="button"
					disabled={running}
					class="border-border text-foreground hover:bg-card rounded-[var(--radius)] border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40"
					onclick={() => void runGet()}
				>
					Derive PRF value (get)
				</button>
			{/if}
		</div>

		{#if verdict}
			<div
				class="rounded-[var(--radius-lg)] border px-4 py-3 text-[13px] {verdict.route === 'A'
					? 'border-border bg-primary/10 text-foreground'
					: 'border-destructive/40 text-destructive'}"
				role="status"
			>
				<span class="font-bold">{verdict.route === 'A' ? '✅ Route A' : '→ Route B'}</span>
				— {verdict.text}
			</div>
		{/if}

		{#if lines.length > 0}
			<div
				class="border-border bg-card rounded-[var(--radius-lg)] border p-3 font-mono text-[12px] leading-relaxed break-all"
			>
				{#each lines as line, i (i)}
					<div
						class={line.level === 'err'
							? 'text-destructive'
							: line.level === 'ok'
								? 'text-foreground font-medium'
								: line.level === 'warn'
									? 'text-foreground opacity-80'
									: 'text-muted-foreground'}
					>
						{line.text}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
