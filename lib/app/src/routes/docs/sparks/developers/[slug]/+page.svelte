<script lang="ts">
	import { renderDocMarkdown } from '$lib/docs/render-doc'

	let { data } = $props()

	const rendered = $derived(renderDocMarkdown(data.doc.raw))
</script>

<svelte:head>
	<title>{data.doc.title} — Sparks · AvenOS</title>
</svelte:head>

<article
	class="doc-markdown min-w-0 flex-1 select-text px-1 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border/50 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted/80 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:scroll-mt-24 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:scroll-mt-24 [&_h3]:text-base [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_p]:leading-relaxed [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border/50 [&_pre]:bg-muted/40 [&_pre]:p-4 [&_pre]:text-[13px] [&_strong]:font-semibold [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border/50 [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm [&_th]:border [&_th]:border-border/50 [&_th]:bg-muted/30 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:opacity-80 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6"
>
	{@html rendered.html}
</article>
