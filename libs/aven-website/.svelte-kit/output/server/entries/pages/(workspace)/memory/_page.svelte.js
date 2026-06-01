import "../../../../chunks/index-server.js";
import { H as attr, W as escape_html, a as ensure_array_like, i as derived, l as stringify, n as attr_class, o as head } from "../../../../chunks/dev.js";
import "../../../../chunks/exports.js";
import "../../../../chunks/stores.js";
import { t as workspaceContentClass } from "../../../../chunks/layout.js";
import { t as renderVaultMarkdown } from "../../../../chunks/markdown-view.js";
//#region src/routes/(workspace)/memory/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let sidebarTab = "knowledge";
		let streamMessages = [];
		let notes = [];
		let filter = "";
		let selectedPath = null;
		let editorContent = "";
		/** Same Markdown table Maia gets under "Vault snapshot" (built from `.data/knowledge`, not a separate index file). */
		let vaultSnapshotMarkdown = "";
		/** Default: readable preview (Obsidian-style); switch to Markdown to edit raw source. */
		let viewMode = "display";
		typeof window !== "undefined" && window.location?.origin && window.location.origin;
		/** Sentinel path — not a real vault file; opens live Path|Title snapshot in the panel. */
		const VAULT_INDEX_PATH = "__aven_vault_index__";
		const MAIA_DOC_PREFIX = "__aven_maia__/";
		const MAIA_DOC_ROWS = [{
			kind: "soul",
			file: "SOUL.md",
			hint: "Identity"
		}, {
			kind: "rules",
			file: "RULES.md",
			hint: "Procedures"
		}];
		function maiaSentinelPath(kind) {
			return `${MAIA_DOC_PREFIX}${kind}`;
		}
		function parseMaiaDocKind(path) {
			if (!path?.startsWith(MAIA_DOC_PREFIX)) return null;
			const k = path.slice(14);
			return k === "soul" || k === "rules" ? k : null;
		}
		function diskPathForMaiaKind(kind) {
			return `.data/agents/maia/${kind === "soul" ? "SOUL.md" : "RULES.md"}`;
		}
		/** Sidebar selection for Talk transcript (`.data/agents/maia/messages/conversation.json` — same as /talk). */
		const MSG_SENTINEL_PREFIX = "__aven_msg__";
		function messageSentinelPath(i) {
			return `${MSG_SENTINEL_PREFIX}${i}`;
		}
		function parseMessageIndex(path) {
			if (!path?.startsWith(MSG_SENTINEL_PREFIX)) return null;
			const n = Number.parseInt(path.slice(12), 10);
			return Number.isFinite(n) && n >= 0 ? n : null;
		}
		const selectedMessageIndex = derived(() => parseMessageIndex(selectedPath));
		const isTalkMessageSelected = derived(() => selectedMessageIndex() !== null);
		const previewHtml = derived(() => viewMode === "display" ? renderVaultMarkdown(editorContent) : "");
		const vaultIndexPanelHtml = derived(() => (vaultSnapshotMarkdown.trim(), ""));
		derived(() => viewMode === "display" ? selectedPath === VAULT_INDEX_PATH ? vaultIndexPanelHtml() : previewHtml() : "");
		const isVaultIndexSelected = derived(() => selectedPath === VAULT_INDEX_PATH);
		const selectedMaiaKind = derived(() => parseMaiaDocKind(selectedPath));
		const isVaultNoteSelected = derived(() => false);
		let graphNeighbors = null;
		function snippetSidebar(text, max = 64) {
			const t = text.trim().replace(/\s+/g, " ");
			if (!t) return "(empty)";
			return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
		}
		derived(() => (notes ?? []).filter((n) => !filter.trim()));
		head("1bls67b", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>Memory — Aven</title>`);
			});
		});
		$$renderer.push(`<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">`);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div${attr_class(`${workspaceContentClass} grid min-h-0 flex-1 grid-cols-1 gap-8 overflow-y-auto lg:min-h-0 lg:overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)] lg:items-stretch`)}><aside class="tech-card flex min-h-0 min-w-0 flex-col overflow-hidden p-4 lg:h-full lg:min-h-0 lg:max-h-full"><div class="mb-3 flex shrink-0 items-center justify-between gap-2"><span class="tech-label shrink-0">Memory</span> <button type="button" class="shrink-0 text-[10px] font-bold uppercase tracking-wider opacity-60 hover:opacity-100">Refresh</button></div> <div class="mb-3 grid shrink-0 grid-cols-2 gap-0.5 rounded-full border border-border/80 bg-white/10 p-0.5" role="tablist" aria-label="Memory sidebar"><button type="button" role="tab"${attr("aria-selected", sidebarTab === "knowledge")}${attr_class(`min-w-0 rounded-full px-1.5 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-colors sm:px-2 ${stringify(sidebarTab === "knowledge" ? "bg-foreground/10 text-foreground" : "opacity-50 hover:opacity-80")}`)}>Knowledge</button> <button type="button" role="tab"${attr("aria-selected", sidebarTab === "messages")}${attr_class(`min-w-0 rounded-full px-1.5 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-colors sm:px-2 ${stringify(sidebarTab === "messages" ? "bg-foreground/10 text-foreground" : "opacity-50 hover:opacity-80")}`)}>Messages</button></div> `);
		if (sidebarTab === "knowledge") {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<input${attr("value", filter)} placeholder="Filter…" class="mb-3 w-full rounded-xl border border-border bg-white/30 px-3 py-2 text-sm outline-none"/> <ul class="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-y-contain max-h-[55vh] lg:max-h-none"><li><button type="button"${attr_class(`w-full rounded-lg border border-dashed border-border/50 px-2 py-1.5 text-left text-sm transition-colors ${stringify(isVaultIndexSelected() ? "border-border/80 bg-foreground/10 font-semibold" : "hover:border-border/80 hover:bg-white/15")}`)}${attr("aria-current", isVaultIndexSelected() ? "page" : void 0)}><span class="block font-mono text-[10px] opacity-50">_index.md</span> <span class="block truncate">Vault index · live snapshot</span> `);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></button></li> <li class="mt-2 border-t border-border/35 pt-2"><span class="mb-2 block px-2 text-[9px] font-bold uppercase tracking-wider text-foreground/35">agents / maia</span></li> <!--[-->`);
			const each_array = ensure_array_like(MAIA_DOC_ROWS);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let row = each_array[$$index];
				$$renderer.push(`<li><button type="button"${attr_class(`w-full rounded-lg border border-transparent px-2 py-1.5 text-left text-sm transition-colors ${stringify(selectedPath === maiaSentinelPath(row.kind) ? "border-border/70 bg-foreground/10 font-semibold" : "hover:border-border/45 hover:bg-white/15")}`)}${attr("aria-current", selectedPath === maiaSentinelPath(row.kind) ? "page" : void 0)}><span class="block font-mono text-[10px] opacity-50">${escape_html(row.file)}</span> <span class="block truncate">${escape_html(row.hint)}</span> <span class="mt-0.5 block text-[9px] font-mono opacity-30">${escape_html(diskPathForMaiaKind(row.kind))}</span></button></li>`);
			}
			$$renderer.push(`<!--]--> `);
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<li class="text-xs opacity-40">Loading…</li>`);
			$$renderer.push(`<!--]--></ul>`);
		} else if (sidebarTab === "messages") {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<p class="mb-2 shrink-0 text-[10px] leading-snug text-foreground/45">Talk transcript — same store as <a class="underline decoration-border/50 hover:opacity-100" href="/talk">/talk</a>.</p> <ul class="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-y-contain max-h-[55vh] lg:max-h-none">`);
			if (streamMessages.length === 0) {
				$$renderer.push("<!--[1-->");
				$$renderer.push(`<li class="text-xs opacity-40">No messages yet — open Talk to chat.</li>`);
			} else {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--[-->`);
				const each_array_2 = ensure_array_like(streamMessages);
				for (let i = 0, $$length = each_array_2.length; i < $$length; i++) {
					let m = each_array_2[i];
					$$renderer.push(`<li><button type="button"${attr_class(`w-full rounded-lg border px-2 py-1.5 text-left text-sm transition-colors ${stringify(selectedPath === messageSentinelPath(i) ? "border-border/70 bg-foreground/10 font-semibold" : "border-transparent hover:border-border/45 hover:bg-white/15")}`)}${attr("aria-current", selectedPath === messageSentinelPath(i) ? "page" : void 0)}><span class="block font-mono text-[10px] opacity-50">${escape_html(m.role === "user" ? "You" : "Maia")}
										· #${escape_html(i + 1)}</span> <span class="block truncate text-[12px] opacity-90">${escape_html(snippetSidebar(m.content))}</span></button></li>`);
				}
				$$renderer.push(`<!--]-->`);
			}
			$$renderer.push(`<!--]--></ul>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></aside> <section class="tech-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4 lg:h-full"><div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">`);
		if (isVaultIndexSelected()) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="min-w-0"><span class="block font-mono text-[10px] font-bold leading-none tracking-tight text-foreground/55">_index.md</span> <span class="tech-label mt-0.5 block normal-case tracking-normal opacity-60">Live snapshot (same as Talk context) · not a file on disk</span></div>`);
		} else if (selectedMaiaKind()) {
			$$renderer.push("<!--[1-->");
			$$renderer.push(`<div class="min-w-0"><span class="block truncate font-mono text-[10px] font-bold leading-none tracking-tight text-foreground/55"${attr("title", diskPathForMaiaKind(selectedMaiaKind()))}>${escape_html(diskPathForMaiaKind(selectedMaiaKind()))}</span> <span class="tech-label mt-0.5 block normal-case tracking-normal opacity-60">Maia runtime · loaded into Talk before the vault table</span></div>`);
		} else if (isTalkMessageSelected() && selectedMessageIndex() !== null) {
			$$renderer.push("<!--[2-->");
			$$renderer.push(`<div class="min-w-0"><span class="block font-mono text-[10px] font-bold leading-none tracking-tight text-foreground/55">${escape_html(`Talk · message ${selectedMessageIndex() + 1} of ${streamMessages.length}`)}</span> <span class="tech-label mt-0.5 block normal-case tracking-normal opacity-60">${escape_html(streamMessages[selectedMessageIndex()]?.role === "user" ? "You" : "Maia")}
							· read-only transcript</span></div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<span class="tech-label">Select a note</span>`);
		}
		$$renderer.push(`<!--]--> <div class="flex shrink-0 flex-wrap items-center gap-2"><div class="inline-flex rounded-full border border-border/80 bg-white/15 p-0.5" role="group" aria-label="Note view"><button type="button"${attr("disabled", true, true)}${attr_class(`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-25 ${stringify(viewMode === "display" ? "bg-foreground/10 text-foreground" : "opacity-50 hover:opacity-80")}`)}>Display</button> <button type="button"${attr("disabled", true, true)}${attr_class(`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-25 ${stringify(viewMode === "markdown" ? "bg-foreground/10 text-foreground" : "opacity-50 hover:opacity-80")}`)}>Markdown</button></div> <button type="button" class="rounded-full border border-border px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-white/20 disabled:opacity-30"${attr("disabled", true, true)}>${escape_html("Save")}</button></div></div> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (isVaultNoteSelected() && graphNeighbors);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <div class="flex min-h-0 flex-1 flex-col">`);
		if (viewMode === "display") {
			$$renderer.push("<!--[0-->");
			if (isTalkMessageSelected()) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<div class="memory-prose min-h-0 w-full max-w-none flex-1 rounded-xl border border-border/90 bg-white/15 p-5 text-sm leading-relaxed overflow-x-hidden overflow-y-auto sm:p-6" role="region" aria-label="Talk message"><pre class="m-0 whitespace-pre-wrap wrap-break-word font-sans text-sm leading-relaxed text-foreground/95">${escape_html(editorContent)}</pre></div>`);
			} else {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<div class="memory-prose min-h-0 w-full max-w-none flex-1 rounded-xl border border-border/90 bg-white/15 p-5 text-sm leading-relaxed overflow-x-hidden overflow-y-auto sm:p-6 [&amp;_table]:text-[11px] sm:[&amp;_table]:text-sm" role="region" aria-label="Rendered note preview">`);
				if (isVaultIndexSelected()) {
					$$renderer.push("<!--[0-->");
					if (!vaultSnapshotMarkdown.trim()) {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<p class="text-xs opacity-35">Empty vault — add Markdown under .data/knowledge.</p>`);
					}
					$$renderer.push(`<!--]-->`);
				} else if (!editorContent.trim()) {
					$$renderer.push("<!--[1-->");
					$$renderer.push(`<p class="text-xs opacity-35">Empty note — use Markdown to add content.</p>`);
				}
				$$renderer.push(`<!--]--></div>`);
			}
			$$renderer.push(`<!--]-->`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<textarea${attr("readonly", isVaultIndexSelected() || isTalkMessageSelected(), true)} class="min-h-[12rem] w-full flex-1 resize-y rounded-xl border border-border/90 bg-white/15 p-4 font-mono text-sm leading-relaxed outline-none focus:ring-1 focus:ring-foreground/20 read-only:cursor-default read-only:bg-white/10" placeholder="Markdown source…" spellcheck="false">`);
			const $$body = escape_html(editorContent);
			if ($$body) $$renderer.push(`${$$body}`);
			$$renderer.push(`</textarea>`);
		}
		$$renderer.push(`<!--]--></div></section></div></div>`);
	});
}
//#endregion
export { _page as default };
