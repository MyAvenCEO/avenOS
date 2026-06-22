<script lang="ts">
import { getBearerToken } from '$lib/auth/auth-client'

// Admin-only inbound-mail viewer (board 0060): list every received email + a detail pane. Reached
// from the admin settings aside; the /api/inbox/* endpoints are server-gated to admins too. The
// email HTML renders in a fully sandboxed iframe (no scripts, no same-origin) so it can't touch the app.
const AI_BASE = import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined

type MailRow = {
	id: string
	message_id: string | null
	from_email: string | null
	from_name: string | null
	to_email: string | null
	subject: string | null
	received_at: string
}
type MailDetail = MailRow & {
	text_body: string | null
	html_body: string | null
	raw_email: string | null
	mailbox_hash: string | null
}

let messages = $state<MailRow[]>([])
let selected = $state<MailDetail | null>(null)
let loading = $state(true)
let error = $state<string | null>(null)
let showRaw = $state(false)

async function api<T>(path: string): Promise<T> {
	if (!AI_BASE) throw new Error('auth server URL not configured')
	const token = getBearerToken()
	const res = await fetch(`${AI_BASE}${path}`, {
		credentials: 'include',
		headers: token ? { Authorization: `Bearer ${token}` } : {}
	})
	if (!res.ok) throw new Error(`HTTP ${res.status}`)
	return (await res.json()) as T
}

async function load(): Promise<void> {
	loading = true
	error = null
	try {
		const data = await api<{ messages: MailRow[] }>('/api/inbox/messages?limit=200')
		messages = data.messages ?? []
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
	} finally {
		loading = false
	}
}

async function openMessage(id: string): Promise<void> {
	showRaw = false
	try {
		const data = await api<{ message: MailDetail }>(`/api/inbox/messages/${id}`)
		selected = data.message ?? null
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
	}
}

$effect(() => {
	void load()
})

function fmt(d: string): string {
	try {
		return new Date(d).toLocaleString()
	} catch {
		return d
	}
}
function sender(m: { from_name: string | null; from_email: string | null }): string {
	return m.from_name || m.from_email || '(unknown)'
}
</script>

<div class="flex min-h-0 flex-1">
	<!-- list -->
	<div class="border-border flex w-80 shrink-0 flex-col border-r">
		<div class="border-border flex items-center justify-between border-b px-4 py-3">
			<h2 class="text-foreground text-base font-semibold">Mail inbox</h2>
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground text-xs"
				onclick={() => void load()}
			>
				↻ Refresh
			</button>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if loading}
				<p class="text-muted-foreground p-4 text-sm">Loading…</p>
			{:else if error}
				<p class="text-destructive p-4 text-sm">{error}</p>
			{:else if messages.length === 0}
				<p class="text-muted-foreground p-4 text-sm">No mail yet.</p>
			{:else}
				{#each messages as m (m.id)}
					<button
						type="button"
						onclick={() => void openMessage(m.id)}
						class="border-border hover:bg-card block w-full border-b px-4 py-3 text-left {selected?.id ===
						m.id
							? 'bg-primary/10'
							: ''}"
					>
						<div class="text-foreground truncate text-[13px] font-medium">{sender(m)}</div>
						<div class="text-foreground/80 truncate text-[13px]">{m.subject || '(no subject)'}</div>
						<div class="text-muted-foreground mt-0.5 text-[11px]">{fmt(m.received_at)}</div>
					</button>
				{/each}
			{/if}
		</div>
	</div>

	<!-- detail -->
	<div class="flex min-h-0 flex-1 flex-col">
		{#if !selected}
			<div class="text-muted-foreground flex flex-1 items-center justify-center text-sm">
				Select a message
			</div>
		{:else}
			<div class="border-border shrink-0 border-b px-6 py-4">
				<h3 class="text-foreground text-lg font-semibold">{selected.subject || '(no subject)'}</h3>
				<div class="text-muted-foreground mt-1 space-y-0.5 text-[13px]">
					<div>
						<b class="text-foreground/70">From:</b>
						{sender(selected)}
						({selected.from_email ?? '—'})
					</div>
					<div><b class="text-foreground/70">To:</b> {selected.to_email ?? '—'}</div>
					<div><b class="text-foreground/70">Received:</b> {fmt(selected.received_at)}</div>
				</div>
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground mt-2 text-xs underline"
					onclick={() => (showRaw = !showRaw)}
				>
					{showRaw ? 'Show formatted' : 'View raw source'}
				</button>
			</div>
			<div class="flex min-h-0 flex-1 flex-col">
				{#if showRaw}
					<pre
						class="text-foreground/80 flex-1 overflow-y-auto p-6 font-mono text-[12px] break-words whitespace-pre-wrap"
					>{selected.raw_email ||
							'(no raw email)'}</pre>
				{:else if selected.html_body}
					<iframe
						title="email"
						srcdoc={selected.html_body}
						sandbox=""
						class="flex-1 border-0 bg-white"
					></iframe>
				{:else}
					<pre
						class="text-foreground/90 flex-1 overflow-y-auto p-6 text-[13px] break-words whitespace-pre-wrap"
					>{selected.text_body ||
							'(empty)'}</pre>
				{/if}
			</div>
		{/if}
	</div>
</div>
