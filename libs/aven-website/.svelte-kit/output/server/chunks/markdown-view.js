import { n as injectWikilinkSpans$1, o as bodyAfterFrontmatter } from "./wikilink-parse.js";
import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
//#region src/lib/memory/markdown-view.ts
function escapeHtml(s) {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
function escapeAttr(s) {
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
/** `[[Humans/Sam]]` / `[[Humans/Sam|Sam]]` → clickable spans (fenced ``` blocks untouched). */
function injectWikilinkSpans(markdown) {
	return injectWikilinkSpans$1(markdown, {
		escapeHtml,
		escapeAttr
	});
}
function parseMarkdownToHtml(markdown) {
	const staged = injectWikilinkSpans(markdown);
	const unsafe = marked.parse(staged, {
		async: false,
		gfm: true
	});
	return DOMPurify.sanitize(unsafe, {
		ALLOW_DATA_ATTR: true,
		ADD_TAGS: ["span"],
		ADD_ATTR: [
			"class",
			"data-wikilink",
			"data-talk-turn"
		]
	});
}
function renderVaultMarkdown(markdown) {
	if (!markdown.trim()) return "";
	return parseMarkdownToHtml(bodyAfterFrontmatter(markdown));
}
//#endregion
export { renderVaultMarkdown as t };
