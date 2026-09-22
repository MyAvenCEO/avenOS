<script lang="ts">
import DOMPurify from 'dompurify'
import { marked } from 'marked'

let { text }: { text: string } = $props()
// Model output is untrusted. No HTML, images, forms, CSS, remote resources or
// executable URLs are admitted. Markdown is presentation, never UI authority.
const renderer = new marked.Renderer()
renderer.html = ({ text }) =>
	text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
renderer.image = ({ text }) =>
	text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
renderer.link = ({ text, href }) =>
	`${text} (${href})`.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const html = $derived(
	typeof window === 'undefined'
		? ''
		: DOMPurify.sanitize(marked.parse(text, { renderer, async: false }) as string, {
				ALLOWED_TAGS: [
					'p',
					'br',
					'strong',
					'em',
					'del',
					'code',
					'pre',
					'blockquote',
					'ul',
					'ol',
					'li',
					'h1',
					'h2',
					'h3',
					'h4',
					'hr',
					'table',
					'thead',
					'tbody',
					'tr',
					'th',
					'td'
				],
				ALLOWED_ATTR: []
			})
)
</script>

<div class="message-body">{@html html}</div>

<style>
.message-body {
	white-space: normal;
	overflow-wrap: anywhere;
	line-height: 1.55;
	min-width: 0;
}
.message-body :global(p) {
	margin: 0.65em 0;
}
.message-body :global(:first-child) {
	margin-top: 0;
}
.message-body :global(:last-child) {
	margin-bottom: 0;
}
.message-body :global(ul),
.message-body :global(ol) {
	padding-left: 1.4em;
	margin: 0.65em 0;
}
.message-body :global(ul) {
	list-style: disc;
}
.message-body :global(ol) {
	list-style: decimal;
}
.message-body :global(li + li) {
	margin-top: 0.25em;
}
.message-body :global(h1),
.message-body :global(h2),
.message-body :global(h3),
.message-body :global(h4) {
	font-size: 1em;
	font-weight: 650;
	margin: 1em 0 0.4em;
}
.message-body :global(table) {
	display: block;
	max-width: 100%;
	overflow-x: auto;
	border-collapse: collapse;
	margin: 0.8em 0;
	font-variant-numeric: tabular-nums;
}
.message-body :global(th),
.message-body :global(td) {
	border-bottom: 1px solid #233b3326;
	padding: 0.45em 0.65em;
	text-align: left;
}
.message-body :global(blockquote) {
	border-left: 2px solid #233b3340;
	padding-left: 0.8em;
	margin: 0.8em 0;
}
.message-body :global(pre) {
	max-width: 100%;
	overflow-x: auto;
	padding: 0.7em;
	border-radius: 0.5em;
	background: #233b3309;
	white-space: pre;
}
.message-body :global(code) {
	font-size: 0.92em;
}
</style>
