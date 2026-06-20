<script lang="ts">
import { type App, listApps, listMachines, listOrgs, type Machine, type Org } from '$lib/fly/client'
import { connectFlyToken, loadFlyToken } from '$lib/vault/store'

// Fly read-only management (board 0055). Paste a Fly token → it's encrypted in the passkey vault
// (server-blind) → decrypted on-device to list orgs/apps/machines. Locally the DEV-fallback key
// powers the whole roundtrip without a signed build.
let token = $state<string | null>(null)
let tokenInput = $state('')
let connecting = $state(false)
let loading = $state(true)
let err = $state<string | null>(null)

let orgs = $state<Org[]>([])
let appsByOrg = $state<Record<string, App[]>>({})
let machinesByApp = $state<Record<string, Machine[]>>({})
let openOrg = $state<string | null>(null)
let openApp = $state<string | null>(null)

let started = false
$effect(() => {
	if (started) return
	started = true
	void init()
})

async function init(): Promise<void> {
	try {
		token = await loadFlyToken()
		if (token) orgs = await listOrgs(token)
	} catch (e) {
		err = e instanceof Error ? e.message : String(e)
	} finally {
		loading = false
	}
}

async function connect(): Promise<void> {
	if (!tokenInput.trim()) return
	connecting = true
	err = null
	try {
		await connectFlyToken(tokenInput.trim())
		token = await loadFlyToken()
		tokenInput = ''
		if (token) orgs = await listOrgs(token)
	} catch (e) {
		err = e instanceof Error ? e.message : String(e)
	} finally {
		connecting = false
	}
}

async function toggleOrg(slug: string): Promise<void> {
	openOrg = openOrg === slug ? null : slug
	if (openOrg && !appsByOrg[slug] && token) {
		try {
			appsByOrg = { ...appsByOrg, [slug]: await listApps(token, slug) }
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		}
	}
}

async function toggleApp(name: string): Promise<void> {
	openApp = openApp === name ? null : name
	if (openApp && !machinesByApp[name] && token) {
		try {
			machinesByApp = { ...machinesByApp, [name]: await listMachines(token, name) }
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		}
	}
}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
	<div class="mx-auto flex w-full max-w-2xl flex-col gap-4">
		<header class="flex flex-col gap-1">
			<h2 class="text-foreground text-base font-semibold">Fly.io</h2>
			<p class="text-muted-foreground text-[13px] leading-relaxed">
				Bring your own Fly API token — stored end-to-end encrypted in your passkey vault (the server
				only ever sees ciphertext). Read-only: your orgs, apps, and machines.
			</p>
		</header>

		{#if err}
			<p class="text-destructive text-[13px]" role="alert">{err}</p>
		{/if}

		{#if loading}
			<p class="text-muted-foreground text-[13px]">Loading…</p>
		{:else if !token}
			<label class="flex flex-col gap-1">
				<span class="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
					Fly API token
				</span>
				<input
					class="border-border bg-card text-foreground rounded-[var(--radius)] border px-3 py-1.5 text-[13px]"
					bind:value={tokenInput}
					type="password"
					placeholder="FlyV1 fm2_…"
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
				>
			</label>
			<div>
				<button
					type="button"
					disabled={connecting || !tokenInput.trim()}
					class="bg-primary text-primary-foreground rounded-[var(--radius)] px-3 py-1.5 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
					onclick={() => void connect()}
				>
					{connecting ? 'Encrypting…' : 'Connect token'}
				</button>
			</div>
			<p class="text-muted-foreground text-[12px]">
				Tip: create a scoped, expiring token with <code>fly tokens create org</code>.
			</p>
		{:else}
			<div class="flex items-center justify-between gap-2">
				<span class="text-muted-foreground text-[12px]">
					Token connected · {orgs.length} org{orgs.length === 1 ? '' : 's'}
				</span>
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground text-[12px]"
					onclick={() => {
						token = null
					}}
				>
					Replace token
				</button>
			</div>

			<div class="flex flex-col gap-1">
				{#each orgs as org (org.id)}
					<div class="border-border rounded-[var(--radius-lg)] border">
						<button
							type="button"
							class="flex w-full items-center justify-between px-3 py-2 text-left text-[13px]"
							onclick={() => void toggleOrg(org.slug)}
						>
							<span class="text-foreground font-medium">{org.name}</span>
							<span class="text-muted-foreground text-[11px]">{org.slug}</span>
						</button>
						{#if openOrg === org.slug}
							<div class="border-border border-t px-3 py-2">
								{#if !appsByOrg[org.slug]}
									<p class="text-muted-foreground text-[12px]">Loading apps…</p>
								{:else if appsByOrg[org.slug].length === 0}
									<p class="text-muted-foreground text-[12px]">No apps.</p>
								{:else}
									{#each appsByOrg[org.slug] as app (app.name)}
										<div class="py-0.5">
											<button
												type="button"
												class="flex w-full items-center justify-between text-left text-[13px]"
												onclick={() => void toggleApp(app.name)}
											>
												<span class="text-foreground">{app.name}</span>
												<span class="text-muted-foreground text-[11px]">{app.status ?? ''}</span>
											</button>
											{#if openApp === app.name}
												<div class="text-muted-foreground pl-3 text-[12px]">
													{#if !machinesByApp[app.name]}
														Loading machines…
													{:else if machinesByApp[app.name].length === 0}
														No machines.
													{:else}
														{#each machinesByApp[app.name] as m (m.id)}
															<div class="flex items-center justify-between gap-2 py-0.5">
																<span>{m.name ?? m.id}</span>
																<span>{m.state ?? ''} {m.region ?? ''}</span>
															</div>
														{/each}
													{/if}
												</div>
											{/if}
										</div>
									{/each}
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
