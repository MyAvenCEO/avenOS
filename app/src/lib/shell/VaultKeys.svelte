<script lang="ts">
import { getVault } from '$lib/vault/client'
import { connectFlyToken, loadFlyToken } from '$lib/vault/store'

// Vault keys + secrets management (board 0055). Lives in Account Settings. Shows which key
// unlocks the vault (passkey vs on-disk device key) and lets the user store/replace the Fly
// token. The Fly tab only READS this; setup happens here.
let loading = $state(true)
let provider = $state<string | null>(null)
let hasToken = $state(false)
let editing = $state(false)
let tokenInput = $state('')
let saving = $state(false)
let err = $state<string | null>(null)

let started = false
$effect(() => {
	if (started) return
	started = true
	void load()
})

async function load(): Promise<void> {
	try {
		const v = await getVault()
		provider =
			v?.credential_id === 'device'
				? 'Device key (plain file on this Mac)'
				: v?.credential_id
					? 'Passkey'
					: null
		hasToken = !!(await loadFlyToken())
	} catch (e) {
		err = e instanceof Error ? e.message : String(e)
	} finally {
		loading = false
	}
}

async function save(): Promise<void> {
	if (!tokenInput.trim()) return
	saving = true
	err = null
	try {
		await connectFlyToken(tokenInput.trim())
		tokenInput = ''
		editing = false
		await load()
	} catch (e) {
		err = e instanceof Error ? e.message : String(e)
	} finally {
		saving = false
	}
}
</script>

<div class="mx-auto flex w-full max-w-xl flex-col gap-5 p-6">
	<header class="flex flex-col gap-1">
		<h2 class="text-foreground text-base font-semibold">Vault keys</h2>
		<p class="text-muted-foreground text-[13px] leading-relaxed">
			Your secrets are end-to-end encrypted in a per-user vault — the server only ever stores
			ciphertext. The key comes from your passkey (on a signed build) or a device key stored on this
			Mac.
		</p>
	</header>

	{#if err}
		<p class="text-destructive text-[13px]" role="alert">{err}</p>
	{/if}

	{#if loading}
		<p class="text-muted-foreground text-[13px]">Loading…</p>
	{:else}
		<div class="flex flex-col gap-0.5">
			<span class="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
				Unlock key
			</span>
			<span class="text-foreground text-[14px]">{provider ?? 'Not set up yet'}</span>
		</div>

		<div class="flex flex-col gap-2">
			<span class="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
				Fly API token
			</span>
			{#if hasToken && !editing}
				<div class="flex items-center justify-between gap-2">
					<span class="text-foreground text-[13px]">✓ stored (encrypted)</span>
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground text-[12px]"
						onclick={() => (editing = true)}
					>
						Replace
					</button>
				</div>
			{:else}
				<input
					class="border-border bg-card text-foreground rounded-[var(--radius)] border px-3 py-1.5 text-[13px]"
					bind:value={tokenInput}
					type="password"
					placeholder="FlyV1 fm2_…"
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
				>
				<div class="flex items-center gap-2">
					<button
						type="button"
						disabled={saving || !tokenInput.trim()}
						class="bg-primary text-primary-foreground rounded-[var(--radius)] px-3 py-1.5 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
						onclick={() => void save()}
					>
						{saving ? 'Encrypting…' : 'Save token'}
					</button>
					{#if editing}
						<button
							type="button"
							class="text-muted-foreground text-[12px]"
							onclick={() => (editing = false)}
						>
							Cancel
						</button>
					{/if}
				</div>
				<p class="text-muted-foreground text-[12px]">
					Tip: create a scoped, expiring token with <code>fly tokens create org</code>.
				</p>
			{/if}
		</div>
	{/if}
</div>
