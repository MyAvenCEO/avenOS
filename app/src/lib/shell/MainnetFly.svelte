<script lang="ts">
import { type App, listApps, listMachines, listOrgs, type Machine, type Org } from '$lib/fly/client'
import { loadFlyToken } from '$lib/vault/store'

// Fly read-only machine view (board 0055). READS the Fly token from the vault (set up in Account
// Settings → Vault keys) and lists orgs → apps → machines. No vault/token setup here.
let token = $state<string | null>(null)
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
				Read-only view of your Fly orgs, apps, and machines.
			</p>
		</header>

		{#if err}
			<p class="text-destructive text-[13px]" role="alert">{err}</p>
		{/if}

		{#if loading}
			<p class="text-muted-foreground text-[13px]">Loading…</p>
		{:else if !token}
			<p
				class="border-border text-muted-foreground rounded-[var(--radius-lg)] border border-dashed px-4 py-6 text-center text-[13px]"
			>
				No Fly token yet. Add one in your account → <span class="text-foreground">Vault keys</span>.
			</p>
		{:else}
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
