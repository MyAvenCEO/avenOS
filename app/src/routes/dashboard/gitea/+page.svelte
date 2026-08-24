<script lang="ts">
import { onMount } from 'svelte'

/**
 * aven-git spike (board 0162) — the app as a PURE REMOTE CLIENT of the user's
 * self-hosted Gitea. Everything here is plain `/api/v1` REST over HTTP: list
 * repos, create a repo, and now open one — its details plus a file/folder
 * browser over the contents API, with a text preview for files. The dev
 * instance comes from `libs/aven-git/gitea-dev.sh up`, which prints the token
 * to paste here; the same page would drive the real per-user server by
 * changing the base URL.
 *
 * Spike-grade on purpose: token in localStorage, no SSO, no actor wiring.
 */

const STORE_URL = 'aven-git.url'
const STORE_TOKEN = 'aven-git.token'

interface Repo {
	name: string
	owner: string
}

interface RepoDetails {
	full_name: string
	description: string
	private: boolean
	default_branch: string
	size: number
	updated_at: string
	clone_url: string
	empty: boolean
}

interface Entry {
	name: string
	path: string
	type: 'file' | 'dir' | string
	size: number
}

let baseUrl = $state('http://localhost:3300')
let token = $state('')
let repos = $state<Repo[]>([])
let newName = $state('')
let busy = $state(false)
let failure = $state<string | null>(null)

/** The open repo, or null while on the list. */
let open = $state<Repo | null>(null)
let details = $state<RepoDetails | null>(null)
/** The repo's branches, and the one the tree is browsed at. */
let branches = $state<string[]>([])
let ref = $state('')
/** Directory currently shown inside the open repo ('' = root). */
let path = $state('')
let entries = $state<Entry[]>([])
/** A file being previewed, if any. */
let file = $state<{ path: string; text: string | null } | null>(null)

const connected = $derived(token.trim() !== '')
const crumbs = $derived(path === '' ? [] : path.split('/'))

onMount(() => {
	baseUrl = localStorage.getItem(STORE_URL) ?? baseUrl
	token = localStorage.getItem(STORE_TOKEN) ?? ''
	if (connected) void refresh()
})

function remember() {
	localStorage.setItem(STORE_URL, baseUrl.trim())
	localStorage.setItem(STORE_TOKEN, token.trim())
}

async function api(apiPath: string, init?: RequestInit): Promise<Response> {
	const res = await fetch(`${baseUrl.trim().replace(/\/$/, '')}/api/v1${apiPath}`, {
		...init,
		headers: {
			Authorization: `token ${token.trim()}`,
			'Content-Type': 'application/json',
			...init?.headers
		}
	})
	if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${apiPath} → HTTP ${res.status}`)
	return res
}

async function refresh() {
	busy = true
	failure = null
	try {
		remember()
		const list = (await (await api('/user/repos')).json()) as Array<{
			name: string
			owner: { login: string }
		}>
		repos = list
			.map((r) => ({ name: r.name, owner: r.owner.login }))
			.sort((a, b) => a.name.localeCompare(b.name))
	} catch (err) {
		failure = err instanceof Error ? err.message : String(err)
	} finally {
		busy = false
	}
}

async function create(event: SubmitEvent) {
	event.preventDefault()
	const name = newName.trim()
	if (name === '' || busy) return
	busy = true
	failure = null
	try {
		await api('/user/repos', {
			method: 'POST',
			body: JSON.stringify({ name, auto_init: true, private: true })
		})
		newName = ''
	} catch (err) {
		failure = err instanceof Error ? err.message : String(err)
	} finally {
		busy = false
	}
	await refresh()
}

/** Open a repo: its details, branches, and the root directory listing. */
async function openRepo(repo: Repo) {
	open = repo
	details = null
	file = null
	branches = []
	busy = true
	failure = null
	try {
		details = (await (await api(`/repos/${repo.owner}/${repo.name}`)).json()) as RepoDetails
		ref = details.default_branch
		const list = (await (await api(`/repos/${repo.owner}/${repo.name}/branches`)).json()) as Array<{
			name: string
		}>
		branches = list.map((b) => b.name).sort()
		await browse('')
	} catch (err) {
		failure = err instanceof Error ? err.message : String(err)
	} finally {
		busy = false
	}
}

/** Switch the browsed branch: back to the root of the tree at that ref. */
async function switchBranch(name: string) {
	ref = name
	await browse('')
}

/** Show one directory of the open repo; dirs first, then files, alphabetical. */
async function browse(dir: string) {
	if (!open) return
	file = null
	failure = null
	try {
		const raw = (await (
			await api(`/repos/${open.owner}/${open.name}/contents/${dir}?ref=${encodeURIComponent(ref)}`)
		).json()) as Entry[]
		entries = raw.sort(
			(a, b) =>
				(a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name)
		)
		path = dir
	} catch (err) {
		// An empty repo has no contents to list — that is a state, not an error.
		if (err instanceof Error && err.message.includes('HTTP 404')) {
			entries = []
			path = dir
		} else {
			failure = err instanceof Error ? err.message : String(err)
		}
	}
}

/** Preview a file: the contents API hands the blob back base64-encoded. */
async function preview(entry: Entry) {
	if (!open) return
	failure = null
	if (entry.size > 512 * 1024) {
		file = { path: entry.path, text: null }
		return
	}
	try {
		const blob = (await (
			await api(
				`/repos/${open.owner}/${open.name}/contents/${entry.path}?ref=${encodeURIComponent(ref)}`
			)
		).json()) as { content: string }
		const bytes = Uint8Array.from(atob(blob.content.replace(/\n/g, '')), (c) => c.charCodeAt(0))
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
		file = { path: entry.path, text }
	} catch (err) {
		// Undecodable = binary; anything else is a real failure.
		if (err instanceof TypeError) file = { path: entry.path, text: null }
		else failure = err instanceof Error ? err.message : String(err)
	}
}

function closeRepo() {
	open = null
	details = null
	branches = []
	ref = ''
	entries = []
	path = ''
	file = null
	failure = null
}

function fmtSize(kb: number): string {
	return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`
}

function fmtBytes(b: number): string {
	if (b < 1024) return `${b} B`
	if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
	return `${(b / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<svelte:head>
	<title>Git · avenOS</title>
</svelte:head>

<main
	class="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6"
>
	<header class="flex flex-col items-center gap-1.5">
		<p class="text-[0.625rem] uppercase tracking-[0.2em] opacity-35">Git</p>
	</header>

	{#if open}
		<!-- ONE repo: its facts on top, its tree below — the list is one ← away. -->
		<section class="flex min-h-0 flex-col gap-3">
			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={closeRepo}
					title="Back to repositories"
					aria-label="Back to repositories"
					class="flex size-8 shrink-0 items-center justify-center rounded-full border border-border transition-colors hover:bg-primary/5"
				>
					<svg
						viewBox="0 0 24 24"
						class="size-4"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M19 12H5" />
						<path d="m12 19-7-7 7-7" />
					</svg>
				</button>
				<h2 class="min-w-0 flex-1 truncate font-mono text-sm">{open.owner}/{open.name}</h2>
			</div>

			{#if details}
				<div
					class="flex flex-col gap-2 rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 text-xs shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
				>
					{#if details.description}
						<p class="opacity-80">{details.description}</p>
					{/if}
					<div class="flex flex-wrap gap-x-4 gap-y-1 opacity-60">
						<span>{details.private ? 'private' : 'public'}</span>
						<span>branch <span class="font-mono">{details.default_branch}</span></span>
						<span>{fmtSize(details.size)}</span>
						<span>updated {new Date(details.updated_at).toLocaleString()}</span>
					</div>
					<p class="select-all font-mono text-[10px] opacity-50">{details.clone_url}</p>
				</div>
			{/if}

			{#if branches.length > 0}
				<!-- The branches: chips, the browsed one filled; clicking re-roots
				     the tree at that ref. The default branch wears its mark. -->
				<div class="flex flex-wrap items-center gap-1.5">
					<!-- lucide:git-branch -->
					<svg
						viewBox="0 0 24 24"
						class="size-3.5 shrink-0 opacity-40"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<line x1="6" x2="6" y1="3" y2="15" />
						<circle cx="18" cy="6" r="3" />
						<circle cx="6" cy="18" r="3" />
						<path d="M18 9a9 9 0 0 1-9 9" />
					</svg>
					{#each branches as branch (branch)}
						<button
							type="button"
							onclick={() => void switchBranch(branch)}
							class="rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors {ref ===
							branch
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-border opacity-60 hover:opacity-100'}"
						>
							{branch}{branch === details?.default_branch ? ' ·' : ''}
						</button>
					{/each}
				</div>
			{/if}

			<!-- Breadcrumb: the path INTO the tree; every segment walks back up. -->
			<nav class="flex flex-wrap items-center gap-1 font-mono text-xs">
				<button
					type="button"
					onclick={() => void browse('')}
					class="rounded px-1 py-0.5 transition-colors hover:bg-primary/5 {path === '' && !file
						? 'font-semibold'
						: 'opacity-60'}"
				>
					{open.name}
				</button>
				{#each crumbs as segment, i (i)}
					<span class="opacity-30">/</span>
					<button
						type="button"
						onclick={() => void browse(crumbs.slice(0, i + 1).join('/'))}
						class="rounded px-1 py-0.5 transition-colors hover:bg-primary/5 {i === crumbs.length - 1 && !file
							? 'font-semibold'
							: 'opacity-60'}"
					>
						{segment}
					</button>
				{/each}
				{#if file}
					<span class="opacity-30">/</span>
					<span class="rounded px-1 py-0.5 font-semibold">{file.path.split('/').at(-1)}</span>
				{/if}
			</nav>

			{#if file}
				<!-- The file: text inline; anything undecodable or huge stays opaque. -->
				{#if file.text === null}
					<p
						class="rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 text-xs opacity-60 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
					>
						Binary or too large to preview.
					</p>
				{:else}
					<pre
						class="min-h-0 flex-1 overflow-auto rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 font-mono text-xs leading-relaxed shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
					>{file.text}</pre>
				{/if}
			{:else}
				<!-- The tree, one directory at a time: folders first, then files. -->
				<ul class="min-h-0 flex-1 space-y-1 overflow-y-auto">
					{#each entries as entry (entry.path)}
						<li>
							<button
								type="button"
								onclick={() => (entry.type === 'dir' ? void browse(entry.path) : void preview(entry))}
								class="flex w-full items-center gap-2.5 rounded-xl border border-foreground/5 bg-surface-raised px-3 py-2 text-left font-mono text-sm shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-colors hover:bg-primary/5"
							>
								{#if entry.type === 'dir'}
									<!-- lucide:folder -->
									<svg
										viewBox="0 0 24 24"
										class="size-4 shrink-0 opacity-60"
										fill="none"
										stroke="currentColor"
										stroke-width="1.5"
										stroke-linejoin="round"
									>
										<path
											d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
										/>
									</svg>
								{:else}
									<!-- lucide:file -->
									<svg
										viewBox="0 0 24 24"
										class="size-4 shrink-0 opacity-40"
										fill="none"
										stroke="currentColor"
										stroke-width="1.5"
										stroke-linejoin="round"
									>
										<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
										<path d="M14 2v4a2 2 0 0 0 2 2h4" />
									</svg>
								{/if}
								<span class="min-w-0 flex-1 truncate">{entry.name}</span>
								{#if entry.type !== 'dir'}
									<span class="shrink-0 text-[10px] opacity-40">{fmtBytes(entry.size)}</span>
								{/if}
							</button>
						</li>
					{:else}
						<li class="px-3 py-2 text-xs opacity-40">
							{details?.empty ? 'Empty repository — no commits yet.' : 'Empty directory.'}
						</li>
					{/each}
				</ul>
			{/if}

			{#if failure}
				<p
					class="rounded-xl border border-error/30 bg-error-muted px-4 py-3 text-error-strong text-xs"
				>
					{failure}
				</p>
			{/if}
		</section>
	{:else}
		<!-- The server: where YOUR Gitea lives and the token that opens it. Local
		     dev today (gitea-dev.sh prints the token), the remote personal server
		     tomorrow — this page never knows the difference. -->
		<section class="flex flex-col gap-3">
			<h2 class="text-sm">Server</h2>
			<div
				class="flex flex-col gap-2 rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<label class="flex items-center gap-3 text-sm">
					<span class="w-14 shrink-0 text-xs opacity-60">URL</span>
					<input
						type="url"
						bind:value={baseUrl}
						placeholder="http://localhost:3300"
						class="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none focus:border-primary"
					>
				</label>
				<label class="flex items-center gap-3 text-sm">
					<span class="w-14 shrink-0 text-xs opacity-60">Token</span>
					<input
						type="password"
						bind:value={token}
						placeholder="from: libs/aven-git/gitea-dev.sh up"
						class="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none focus:border-primary"
					>
				</label>
				<button
					type="button"
					onclick={() => void refresh()}
					disabled={!connected || busy}
					class="self-end rounded-lg bg-primary px-3 py-1.5 text-primary-foreground text-xs transition-opacity disabled:opacity-30"
				>
					{busy ? 'Connecting…' : 'Connect'}
				</button>
			</div>
		</section>

		{#if failure}
			<p
				class="rounded-xl border border-error/30 bg-error-muted px-4 py-3 text-error-strong text-xs"
			>
				{failure}
			</p>
		{/if}

		<!-- The repos: click one to open its details and tree. -->
		<section class="flex min-h-0 flex-col gap-3">
			<div class="flex items-baseline justify-between">
				<h2 class="text-sm">Repositories</h2>
				<span class="text-xs opacity-40">{repos.length}</span>
			</div>

			<form onsubmit={create} class="flex gap-2">
				<input
					type="text"
					bind:value={newName}
					placeholder="new-repo-name"
					disabled={!connected}
					class="min-w-0 flex-1 rounded-xl border border-foreground/5 bg-surface-raised px-3 py-2 font-mono text-xs shadow-[0_1px_3px_rgba(30,41,59,0.05)] outline-none focus:border-primary disabled:opacity-40"
				>
				<button
					type="submit"
					disabled={!connected || busy || newName.trim() === ''}
					class="shrink-0 rounded-xl bg-primary px-3 py-2 text-primary-foreground text-xs transition-opacity disabled:opacity-30"
				>
					Create
				</button>
			</form>

			<ul class="min-h-0 flex-1 space-y-1 overflow-y-auto">
				{#each repos as repo (repo.owner + '/' + repo.name)}
					<li>
						<button
							type="button"
							onclick={() => void openRepo(repo)}
							class="flex w-full items-center gap-2.5 rounded-xl border border-foreground/5 bg-surface-raised px-3 py-2 text-left font-mono text-sm shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-colors hover:bg-primary/5"
						>
							<span class="min-w-0 flex-1 truncate">{repo.name}</span>
							<svg
								viewBox="0 0 24 24"
								class="size-4 shrink-0 opacity-30"
								fill="none"
								stroke="currentColor"
								stroke-width="1.75"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="m9 18 6-6-6-6" />
							</svg>
						</button>
					</li>
				{:else}
					<li class="px-3 py-2 text-xs opacity-40">
						{connected ? 'No repositories yet.' : 'Paste the token, then connect.'}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</main>
