import "../../../../chunks/index-server.js";
import { H as attr, W as escape_html, a as ensure_array_like, n as attr_class, o as head } from "../../../../chunks/dev.js";
import { t as maiaAgent } from "../../../../chunks/maia-agent.js";
import { t as workspaceContentClass } from "../../../../chunks/layout.js";
import "../../../../chunks/markdown-view.js";
//#endregion
//#region src/lib/aven/talk-actor-links.ts
/**
* Build hrefs from Maia agent manifest paths to workspace routes.
*/
var MAIA_MSG_JSON = ".data/agents/maia/messages/conversation.json";
function memoryHrefForVaultPath(relativePath) {
	const p = relativePath.trim();
	if (!p) return "/memory";
	return `/memory?path=${encodeURIComponent(p)}`;
}
/** Conversation file → stay on Talk and jump to transcript panel. */
function talkTranscriptHref() {
	return "/talk#ctx-transcript";
}
/** Resolve a bundled source path to Memory (vault file) or Talk (transcript). */
function hrefForAgentSourcePath(relativePath) {
	const p = relativePath.trim();
	if (p === MAIA_MSG_JSON) return talkTranscriptHref();
	return memoryHrefForVaultPath(p);
}
//#endregion
//#region src/routes/(workspace)/talk/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let draft = "";
		let bootingConversation = true;
		typeof window !== "undefined" && window.location?.origin && window.location.origin;
		head("z5vtvk", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>Talk — Aven Maia</title>`);
			});
		});
		$$renderer.push(`<div${attr_class(`${workspaceContentClass} flex min-h-0 flex-1 flex-col overflow-hidden`, "svelte-z5vtvk")}>`);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <main class="flex w-full min-h-0 flex-1 flex-col gap-6 overflow-hidden lg:flex-row lg:items-stretch lg:gap-6"><div class="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"><div class="mb-2 flex min-h-6 shrink-0 flex-col gap-0.5"><span class="tech-label opacity-35">Talk · request payload</span> <p class="text-[11px] leading-snug opacity-45">Everything below is what the server composes for the model on each roundtrip (system
					bundle + tool schemas + transcript).</p></div> <div id="talk-context-scroll" class="min-h-0 flex-1 space-y-4 overflow-y-auto scroll-pb-40 pr-1 max-lg:min-h-[46vh] pb-36 sm:scroll-mt-2"><details name="talk-ctx" id="ctx-actor-config" class="talk-ctx-disclosure scroll-mt-12 rounded-2xl border border-border/70 bg-white/10 p-4 sm:p-5 svelte-z5vtvk" aria-labelledby="ctx-actor-config-h"><summary class="tech-label cursor-pointer list-none border-b border-border/35 pb-2 normal-case !text-[11px] [&amp;::-webkit-details-marker]:hidden svelte-z5vtvk"><span class="flex items-start gap-2"><span class="talk-ctx-chevron mt-0.5 shrink-0 text-[10px] opacity-45 svelte-z5vtvk" aria-hidden="true">▸</span> <span class="min-w-0 flex-1"><span id="ctx-actor-config-h" class="block opacity-90">Actor · <span class="font-mono">maia.agent.json</span></span> <p class="mt-1 font-mono text-[10px] leading-snug opacity-55">${escape_html(maiaAgent.id)}
									· v${escape_html(maiaAgent.version)}</p> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></span> <span class="shrink-0 rounded-full border border-border/50 px-2 py-0.5 text-[10px] font-semibold opacity-80">${escape_html(maiaAgent.name)}</span></span></summary> <div><dl class="mt-3 grid gap-2 text-[11px] leading-snug sm:grid-cols-2"><div class="rounded-xl border border-border/40 bg-white/6 px-3 py-2"><dt class="tech-label mb-1 opacity-50">LLM provider</dt> <dd class="m-0 font-mono">${escape_html(maiaAgent.llm.provider)}</dd></div> <div class="rounded-xl border border-border/40 bg-white/6 px-3 py-2"><dt class="tech-label mb-1 opacity-50">Default model</dt> <dd class="m-0 font-mono">${escape_html(maiaAgent.llm.defaultModel)}</dd></div> <div class="rounded-xl border border-border/40 bg-white/6 px-3 py-2"><dt class="tech-label mb-1 opacity-50">Temperature</dt> <dd class="m-0 font-mono">${escape_html(String(maiaAgent.llm.temperature))}</dd></div> <div class="rounded-xl border border-border/40 bg-white/6 px-3 py-2"><dt class="tech-label mb-1 opacity-50">Max tool rounds</dt> <dd class="m-0 font-mono">${escape_html(String(maiaAgent.llm.maxToolRounds))}</dd></div> <div class="rounded-xl border border-border/40 bg-white/6 px-3 py-2"><dt class="tech-label mb-1 opacity-50">Tool choice</dt> <dd class="m-0 font-mono">${escape_html(maiaAgent.llm.toolChoice)}</dd></div> `);
		if (maiaAgent.llm.fallbackConfigFiles?.length) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="sm:col-span-2 rounded-xl border border-border/40 bg-white/6 px-3 py-2"><dt class="tech-label mb-1 opacity-50">Fallback configs</dt> <dd class="m-0 flex flex-wrap gap-1.5"><!--[-->`);
			const each_array = ensure_array_like(maiaAgent.llm.fallbackConfigFiles);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let file = each_array[$$index];
				$$renderer.push(`<a${attr("href", memoryHrefForVaultPath(file))} class="break-all font-mono text-[10px] text-foreground underline decoration-border/60 underline-offset-2 hover:decoration-foreground/80">${escape_html(file)}</a>`);
			}
			$$renderer.push(`<!--]--></dd></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></dl> <div class="mt-4 space-y-2 text-[11px]"><p class="tech-label mb-1 opacity-50">Sources</p> <ul class="m-0 list-none space-y-2 p-0"><li class="rounded-xl border border-border/35 bg-white/4 px-3 py-2"><span class="tech-label block text-[9px] opacity-45">identityMarkdown</span> <a${attr("href", hrefForAgentSourcePath(maiaAgent.sources.identityMarkdown))} class="mt-0.5 block break-all font-mono text-[10px] text-foreground underline decoration-border/60 underline-offset-2 hover:decoration-foreground/80">${escape_html(maiaAgent.sources.identityMarkdown)}</a></li> <li class="rounded-xl border border-border/35 bg-white/4 px-3 py-2"><span class="tech-label block text-[9px] opacity-45">systemPrompt</span> <a${attr("href", hrefForAgentSourcePath(maiaAgent.sources.systemPrompt.path))} class="mt-0.5 block break-all font-mono text-[10px] text-foreground underline decoration-border/60 underline-offset-2 hover:decoration-foreground/80">${escape_html(maiaAgent.sources.systemPrompt.path)}</a> `);
		if (maiaAgent.sources.systemPrompt.seedPath) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<span class="mt-1 block text-[9px] opacity-40">seed · <span class="font-mono">${escape_html(maiaAgent.sources.systemPrompt.seedPath)}</span></span>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></li> <li class="rounded-xl border border-border/35 bg-white/4 px-3 py-2"><span class="tech-label block text-[9px] opacity-45">tools.openAiFunctionSchemas</span> <a${attr("href", memoryHrefForVaultPath(maiaAgent.sources.tools.openAiFunctionSchemas))} class="mt-0.5 block break-all font-mono text-[10px] text-foreground underline decoration-border/60 underline-offset-2 hover:decoration-foreground/80">${escape_html(maiaAgent.sources.tools.openAiFunctionSchemas)}</a></li> <li class="rounded-xl border border-border/35 bg-white/4 px-3 py-2"><span class="tech-label block text-[9px] opacity-45">transcript</span> <a${attr("href", talkTranscriptHref())} class="mt-0.5 block break-all font-mono text-[10px] text-foreground underline decoration-border/60 underline-offset-2 hover:decoration-foreground/80">${escape_html(maiaAgent.sources.transcript.conversationJsonRelative)}</a> <span class="mt-1 block font-mono text-[9px] opacity-45">${escape_html(maiaAgent.sources.transcript.messageMarkdownGlob)}</span></li></ul></div> <div class="mt-3 grid gap-1 text-[10px] leading-snug opacity-60 sm:grid-cols-2"><p class="m-0"><span class="tech-label opacity-50">Bundle delimiter</span> <span class="ml-1 font-mono">${escape_html(maiaAgent.systemBundle.delimiterMarkdown)}</span></p> <p class="m-0 sm:col-span-2"><span class="tech-label opacity-50">Snapshot heading template</span> <span class="ml-1 font-mono">${escape_html(maiaAgent.systemBundle.snapshotHeadingMarkdownTemplate)}</span></p></div> <details class="mt-4 rounded-xl border border-border/40 bg-white/4 p-3"><summary class="cursor-pointer text-[10px] font-semibold uppercase tracking-wide opacity-70 [&amp;::-webkit-details-marker]:hidden">Raw JSON</summary> <pre class="mt-2 max-h-[min(50vh,20rem)] overflow-auto whitespace-pre-wrap border-t border-border/30 pt-2 font-mono text-[9px] leading-relaxed text-foreground/88 sm:text-[10px]">${escape_html(JSON.stringify(maiaAgent, null, 2))}</pre></details></div></details> `);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<p class="text-sm opacity-35 leading-relaxed">Loading conversation and context…</p>`);
		$$renderer.push(`<!--]--></div></div> <aside class="flex w-full shrink-0 flex-col overflow-hidden border-t border-border/40 pt-4 min-h-0 min-w-0 lg:w-52 lg:border-l lg:border-t-0 lg:pt-0 xl:w-56" aria-label="Jump to context section"><div class="mb-2 shrink-0 lg:sticky lg:top-0 lg:z-10 lg:bg-background/85 lg:pb-2 lg:backdrop-blur-sm"><span class="tech-label block opacity-60">On this page</span></div> <nav class="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto overscroll-contain pr-1 text-[11px] leading-snug lg:max-h-none"><ul class="m-0 mb-2 list-none space-y-1 border-b border-border/30 pb-2 p-0"><li><a href="#ctx-actor-config"${attr("title", "Jump to bundled maia.agent.json and request summary.")} class="flex flex-col gap-1 rounded-lg border border-transparent px-2 py-2 transition-colors hover:border-border/50 hover:bg-white/10"><span class="opacity-90">Actor · maia.agent.json</span> <span class="break-all font-mono text-[9px] tabular-nums opacity-45">${escape_html(maiaAgent.id)}</span> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></a></li></ul> `);
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<p class="text-[10px] opacity-40">Send a message to load context outline.</p>`);
		$$renderer.push(`<!--]--></nav></aside></main> <div class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center bg-gradient-to-t from-background from-40% via-background/95 to-transparent px-6 pb-6 pt-10 sm:px-8"><div${attr_class(`pointer-events-auto flex flex-col items-center ${workspaceContentClass}`)}>`);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <section class="tech-pill w-full justify-between gap-4 py-3 px-4 sm:px-5"><div class="flex flex-1 min-w-0 items-center gap-3"><div class="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-white/20"><svg class="size-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg></div> <form class="min-w-0 flex-1"><input${attr("value", draft)} placeholder="Message Maia…"${attr("disabled", bootingConversation, true)} class="w-full min-w-0 border-none bg-transparent p-0 text-xl font-medium tracking-tight outline-none placeholder:opacity-20 focus:ring-0 disabled:opacity-40"/></form></div> <div class="ml-1 flex shrink-0 items-center self-stretch border-l border-border pl-3"><span class="text-[10px] font-bold uppercase tracking-[0.2em] opacity-35">Maia</span></div></section></div></div></div>`);
	});
}
//#endregion
export { _page as default };
