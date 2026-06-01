import { U as clsx, l as stringify, n as attr_class } from "./dev.js";
//#region src/lib/components/MarketingSiteHeader.svelte
function MarketingSiteHeader($$renderer, $$props) {
	let { active = null, maxWidth = "5xl" } = $$props;
	const maxW = maxWidth === "6xl" ? "max-w-6xl" : "max-w-5xl";
	function linkCls(isActive) {
		return isActive ? "opacity-100 transition-opacity" : "transition-opacity hover:opacity-100";
	}
	$$renderer.push(`<header class="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md"><div${attr_class(`mx-auto flex ${stringify(maxW)} flex-wrap items-center justify-center gap-x-10 gap-y-2 px-5 py-5 sm:justify-between sm:px-8`)}><a href="/" class="font-serif text-[17px] font-light tracking-[-0.01em] opacity-85 hover:opacity-100">AvenCEO</a> <nav class="flex items-center gap-5 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-70"><a href="/skills"${attr_class(clsx(linkCls(active === "skills")))}>Skills</a> <a href="/pricing"${attr_class(clsx(linkCls(active === "pricing")))}>Preise</a> <a href="/docs"${attr_class(clsx(linkCls(active === "docs")))}>Docs</a> <a href="/me" class="rounded-full border border-border/80 bg-white/15 px-3 py-1 opacity-95 transition-opacity hover:opacity-100">Login</a></nav></div></header>`);
}
//#endregion
export { MarketingSiteHeader as t };
