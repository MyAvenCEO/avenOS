import { c as store_get, l as stringify, n as attr_class, u as unsubscribe_stores } from "../../../chunks/dev.js";
import "../../../chunks/navigation.js";
import { t as page } from "../../../chunks/stores.js";
import { t as workspaceContentClass } from "../../../chunks/layout.js";
//#region src/lib/workspace/WorkspaceHeader.svelte
function WorkspaceHeader($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		$$renderer.push(`<header${attr_class(`mb-3 sm:mb-4 grid grid-cols-3 items-center gap-x-2 gap-y-3 ${workspaceContentClass}`)}><div class="min-w-0" aria-hidden="true"></div> <nav class="flex flex-wrap items-center justify-center justify-self-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-wider" aria-label="Workspace sections"><a href="/me" data-sveltekit-preload-data="off"${attr_class(`uppercase opacity-40 transition-opacity hover:opacity-80 ${stringify(store_get($$store_subs ??= {}, "$page", page).url.pathname === "/me" ? "opacity-95 underline underline-offset-4" : "")}`)}>Me</a> <span class="opacity-25 select-none" aria-hidden="true">|</span> <a href="/talk" data-sveltekit-preload-data="off"${attr_class(`uppercase opacity-40 transition-opacity hover:opacity-80 ${stringify(store_get($$store_subs ??= {}, "$page", page).url.pathname === "/talk" ? "opacity-95 underline underline-offset-4" : "")}`)}>Talk</a> <span class="opacity-25 select-none" aria-hidden="true">|</span> <a href="/intents" data-sveltekit-preload-data="off"${attr_class(`uppercase opacity-40 transition-opacity hover:opacity-80 ${stringify(store_get($$store_subs ??= {}, "$page", page).url.pathname === "/intents" ? "opacity-95 underline underline-offset-4" : "")}`)}>Intents</a> <span class="opacity-25 select-none" aria-hidden="true">|</span> <a href="/memory" data-sveltekit-preload-data="off"${attr_class(`uppercase opacity-40 transition-opacity hover:opacity-80 ${stringify(store_get($$store_subs ??= {}, "$page", page).url.pathname === "/memory" ? "opacity-95 underline underline-offset-4" : "")}`)}>Brain</a></nav> <div class="flex min-w-0 items-center justify-end justify-self-end gap-2 sm:gap-3"><span class="min-w-0 truncate text-right text-lg font-medium tracking-tight opacity-50 sm:text-xl" title="Jazz profile sync disabled (POC dewired)">You</span></div></header>`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
//#region src/routes/(workspace)/+layout.svelte
function _layout($$renderer, $$props) {
	let { children: pageContent } = $$props;
	$$renderer.push(`<div class="box-border flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-background px-6 pt-4 pb-24 sm:px-8 sm:pt-5 sm:pb-28">`);
	WorkspaceHeader($$renderer, {});
	$$renderer.push(`<!----> <div class="flex min-h-0 flex-1 flex-col overflow-hidden">`);
	pageContent($$renderer);
	$$renderer.push(`<!----></div></div>`);
}
//#endregion
export { _layout as default };
