<!-- One renderer for every legal document from @avenos/aven-brand — the
     content is data, the markup lives exactly once, here. -->
<script lang="ts">
import type { LegalBlock, LegalDocument } from '@avenos/aven-brand'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import SiteFooter from '$lib/components/SiteFooter.svelte'
import type { Lang } from '$lib/i18n'

let { doc }: { doc: LegalDocument } = $props()

const lang = $derived(doc.lang as Lang)
const eyebrow = $derived(doc.lang === 'de' ? 'Rechtliches' : 'Legal')

/** Heading style per source depth — 2 is a chapter, 5 a fine print label. */
const HEADING: Record<number, string> = {
	2: 'mt-12 text-xl font-semibold tracking-tight text-foreground border-b border-border/50 pb-2',
	3: 'mt-8 text-[17px] font-semibold tracking-tight text-foreground',
	4: 'mt-6 text-[15px] font-semibold text-foreground',
	5: 'mt-5 text-[13.5px] font-semibold text-foreground/85'
}

function isList(block: LegalBlock): block is { items: string[] } {
	return 'items' in block
}

/**
 * The documents link to nothing but bare URLs (the link text IS the URL), so
 * a line splits into text and link parts right here — no inline markup model.
 */
function parts(line: string): { text: string; href?: string }[] {
	// A real URL needs a host after the scheme and must end on a word char or
	// slash — so the quoted schemes in the SSL prose („http://“ auf
	// „https://“) and a sentence-ending dot never become links. The regex is
	// re-created per call: split() and test() must not share lastIndex state.
	const url = () => /(https?:\/\/[\w-]+(?:\.[\w-]+)+[^\s„“”"'<>]*[\w/])/g
	return line
		.split(url())
		.filter((part) => part !== '')
		.map((part) => {
			const m = part.match(/^https?:\/\/[\w-]+(?:\.[\w-]+)+/)
			return m ? { text: part, href: part } : { text: part }
		})
}
</script>

<svelte:head>
	<title>{doc.title.replaceAll('­', '')} — aven.ceo</title>
</svelte:head>

<div {lang} class="flex min-h-screen flex-col bg-background text-foreground font-sans antialiased">
	<MarketingSiteHeader {lang} />

	<section class="flex-1 px-5 py-16 sm:px-8 sm:py-20">
		<div class="mx-auto max-w-2xl">
			<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">{eyebrow}</p>
			<h1 class="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
				{doc.title}
			</h1>

			{#each doc.sections as section, s (s)}
				{#if section.title}
					<svelte:element this={`h${section.level ?? 2}`} class={HEADING[section.level ?? 2]}>
						{section.title}
					</svelte:element>
				{/if}
				{#each section.blocks as block, i (i)}
					{#if isList(block)}
						<ul class="mt-3 space-y-2 text-[15px] leading-relaxed text-foreground/75">
							{#each block.items as item, j (j)}
								<li class="flex gap-2">
									<span
										aria-hidden="true"
										class="mt-2.5 size-1.5 shrink-0 rounded-full bg-foreground/25"
									></span>
									<span class="break-words"
										>{#each parts(item) as part, k (k)}
											{#if part.href}
												<a
													href={part.href}
													target="_blank"
													rel="noopener noreferrer"
													class="underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground/70"
													>{part.text}</a
												>
											{:else}
												{part.text}
											{/if}
										{/each}</span
									>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="mt-3 text-[15px] leading-relaxed text-foreground/75 break-words">
							{#if block.lead}
								<strong class="font-semibold text-foreground/90">{block.lead}</strong><br>
							{/if}
							{#each block.lines as line, l (l)}
								{#if l > 0}
									<br>
								{/if}
								{#each parts(line) as part, k (k)}
									{#if part.href}
										<a
											href={part.href}
											target="_blank"
											rel="noopener noreferrer"
											class="underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground/70"
											>{part.text}</a
										>
									{:else}
										{part.text}
									{/if}
								{/each}
							{/each}
						</p>
					{/if}
				{/each}
			{/each}
		</div>
	</section>

	<SiteFooter {lang} />
</div>
