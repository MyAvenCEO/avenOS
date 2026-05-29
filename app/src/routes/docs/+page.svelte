<script lang="ts">
	import { contentIntroHref } from '$lib/docs/content-collection'
	import { firstFounderSlug } from '$lib/docs/self-collection'
	import { navigateApp } from '$lib/shell'
	import { firstFounderSlug as networkFirstSlug } from '$lib/docs/network-collection'
	import { firstFounderSlug as sparksFirstSlug } from '$lib/docs/sparks-collection'

	const selfHref = firstFounderSlug ? `/docs/self/founders/${firstFounderSlug}` : '/docs'
	const networkHref = networkFirstSlug ? `/docs/network/founders/${networkFirstSlug}` : '/docs'
	const sparksHref = sparksFirstSlug ? `/docs/sparks/founders/${sparksFirstSlug}` : '/docs'
	const contentHref = contentIntroHref
</script>

<svelte:head>
	<title>Dokumentation — @AvenOS/app</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background font-sans text-foreground antialiased">
	<main class="flex-1 px-6 py-10 sm:px-10 sm:py-14">
		<div class="mx-auto max-w-5xl">
			<header class="mb-10">
				<p class="tech-label mb-3">Dokumentation</p>
				<h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">AvenOS</h1>
				<p class="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
					<strong class="font-medium text-foreground">AvenOS</strong> ist das Betriebssystem unter
					deinem AvenCEO — mit Ende-zu-Ende-Verschlüsselung, Daten die dir gehören und einem KI,
					der mit dir wächst. Hier findest du, wie die einzelnen Teile zusammenspielen.
				</p>
			</header>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<a
					href="/docs/vibe-apps"
					class="tech-card group flex flex-col gap-3 p-5 no-underline transition-all hover:bg-white/20"
				>
					<div
						class="flex size-9 items-center justify-center rounded-xl border border-border/60 bg-white/20 text-foreground/60 transition-colors group-hover:border-[color:var(--color-tuscan-sun)]/50 group-hover:text-foreground"
					>
						<svg
							class="size-4"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							aria-hidden="true"
						>
							<rect x="3" y="3" width="7" height="7" rx="1.5" />
							<rect x="14" y="3" width="7" height="7" rx="1.5" />
							<rect x="3" y="14" width="7" height="7" rx="1.5" />
							<rect x="14" y="14" width="7" height="7" rx="1.5" />
						</svg>
					</div>
					<div>
						<p class="text-sm font-semibold tracking-tight text-foreground">Vibe-View Library</p>
						<p class="mt-0.5 text-xs leading-snug text-muted-foreground">
							Alle Ansichten live im Browser — so sehen deine Daten in AvenCEO aus.
						</p>
					</div>
					<span
						class="mt-auto flex items-center gap-1 text-[10px] font-bold tracking-widest text-muted-foreground uppercase opacity-50 transition-opacity group-hover:opacity-100"
					>
						Öffnen
						<svg
							class="size-3"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</span>
				</a>
				<a
					href={selfHref}
					data-sveltekit-preload-data="hover"
					class="tech-card group flex flex-col gap-3 p-5 no-underline transition-all hover:bg-white/20"
				>
					<div
						class="flex size-9 items-center justify-center rounded-xl border border-border/60 bg-white/20 text-foreground/60 transition-colors group-hover:border-[color:var(--color-tuscan-sun)]/50 group-hover:text-foreground"
					>
						<svg
							class="size-4"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							aria-hidden="true"
						>
							<path
								d="M12 3l8 4v5.5C20 16.5 15.5 20.5 12 22 8.5 20.5 4 16 4 12.5V7l8-4z"
								stroke-linejoin="round"
							/>
							<path d="M9 12l2 2 4-4" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</div>
					<div>
						<p class="text-sm font-semibold tracking-tight text-foreground">Self &amp; device keys</p>
						<p class="mt-0.5 text-xs leading-snug text-muted-foreground">
							Plain-English architecture: Secure Enclave, network anchor, signing — how your Mac
							proves it is you.
						</p>
					</div>
					<span
						class="mt-auto flex items-center gap-1 text-[10px] font-bold tracking-widest text-muted-foreground uppercase opacity-50 transition-opacity group-hover:opacity-100"
					>
						Open
						<svg
							class="size-3"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</span>
				</a>
				<a
					href={networkHref}
					data-sveltekit-preload-data="hover"
					class="tech-card group flex flex-col gap-3 p-5 no-underline transition-all hover:bg-white/20"
				>
					<div
						class="flex size-9 items-center justify-center rounded-xl border border-border/60 bg-white/20 text-foreground/60 transition-colors group-hover:border-[color:var(--color-tuscan-sun)]/50 group-hover:text-foreground"
					>
						<svg
							class="size-4"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							aria-hidden="true"
						>
							<circle cx="6" cy="12" r="2" />
							<circle cx="18" cy="6" r="2" />
							<circle cx="18" cy="18" r="2" />
							<path d="M8 11.5l8-4M8 12.5l8 4" stroke-linecap="round" />
						</svg>
					</div>
					<div>
						<p class="text-sm font-semibold tracking-tight text-foreground">My Network</p>
						<p class="mt-0.5 text-xs leading-snug text-muted-foreground">
							Invite-only peer allowlist, per-pair transport topics, share-nothing by default.
						</p>
					</div>
					<span
						class="mt-auto flex items-center gap-1 text-[10px] font-bold tracking-widest text-muted-foreground uppercase opacity-50 transition-opacity group-hover:opacity-100"
					>
						Open
						<svg
							class="size-3"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</span>
				</a>
				<a
					href={contentHref}
					data-sveltekit-preload-data="hover"
					class="tech-card group flex flex-col gap-3 p-5 no-underline transition-all hover:bg-white/20"
					onclick={(e) => navigateApp(contentHref, e)}
				>
					<div
						class="flex size-9 items-center justify-center rounded-xl border border-border/60 bg-white/20 text-foreground/60 transition-colors group-hover:border-[color:var(--color-tuscan-sun)]/50 group-hover:text-foreground"
					>
						<svg
							class="size-4"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							aria-hidden="true"
						>
							<path
								d="M4 6h16M4 12h10M4 18h14"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
							<path d="M17 10l3 2-3 2" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</div>
					<div>
						<p class="text-sm font-semibold tracking-tight text-foreground">Storytelling</p>
						<p class="mt-0.5 text-xs leading-snug text-muted-foreground">
							The World We Deserve bible — identity sheet, PAST storytelling, characters, and the
							episode test.
						</p>
					</div>
					<span
						class="mt-auto flex items-center gap-1 text-[10px] font-bold tracking-widest text-muted-foreground uppercase opacity-50 transition-opacity group-hover:opacity-100"
					>
						Open
						<svg
							class="size-3"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</span>
				</a>
				<a
					href={sparksHref}
					data-sveltekit-preload-data="hover"
					class="tech-card group flex flex-col gap-3 p-5 no-underline transition-all hover:bg-white/20"
				>
					<div
						class="flex size-9 items-center justify-center rounded-xl border border-border/60 bg-white/20 text-foreground/60 transition-colors group-hover:border-[color:var(--color-tuscan-sun)]/50 group-hover:text-foreground"
					>
						<svg
							class="size-4"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							aria-hidden="true"
						>
							<path d="M12 2l8 4v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4z" stroke-linejoin="round" />
							<path d="M9 12l2 2 4-4" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</div>
					<div>
						<p class="text-sm font-semibold tracking-tight text-foreground">Sparks</p>
						<p class="mt-0.5 text-xs leading-snug text-muted-foreground">
							Workspaces, biscuit admins, and biscuit-gated sync for encrypted data.
						</p>
					</div>
					<span
						class="mt-auto flex items-center gap-1 text-[10px] font-bold tracking-widest text-muted-foreground uppercase opacity-50 transition-opacity group-hover:opacity-100"
					>
						Open
						<svg
							class="size-3"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</span>
				</a>
			</div>
		</div>
	</main>
</div>
