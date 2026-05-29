import "../../../../chunks/index-server.js";
import { W as escape_html, n as attr_class, o as head, r as attr_style } from "../../../../chunks/dev.js";
import { Background, BaseEdge, Controls, EdgeLabel, SvelteFlow, getBezierPath } from "@xyflow/svelte";
import "@dagrejs/dagre";
//#region src/lib/actor-graph/ActorNode.svelte
function ActorNode($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const { data } = $$props;
		function tone(status) {
			switch (status) {
				case "running": return "border-amber-400/60 bg-amber-50 text-amber-950";
				case "failed": return "border-red-400/60 bg-red-50 text-red-950";
				case "stopped": return "border-stone-400/60 bg-stone-50 text-stone-700";
				default: return "border-emerald-400/40 bg-white text-foreground";
			}
		}
		$$renderer.push(`<div${attr_class(`min-w-[220px] rounded-xl border px-3 py-2 shadow-sm ${tone(data.actor.status)}`)}><div class="flex items-start justify-between gap-2"><div><p class="text-xs font-bold uppercase opacity-50">${escape_html(data.actor.type)}</p> <p class="text-sm font-semibold">${escape_html(data.actor.name)}</p> <p class="font-mono text-[10px] opacity-60">${escape_html(data.actor.id)}</p></div> <span class="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase">${escape_html(data.actor.status)}</span></div> <div class="mt-2 grid grid-cols-2 gap-2 text-[11px] opacity-75"><div>mailbox: ${escape_html(data.actor.mailboxDepth)}</div> <div>restarts: ${escape_html(data.actor.restartCount)}</div></div> `);
		if (data.actor.currentTask) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<p class="mt-2 text-[11px] opacity-75">task: ${escape_html(data.actor.currentTask)}</p>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div>`);
	});
}
//#endregion
//#region src/lib/actor-graph/MessageEdge.svelte
function MessageEdge($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const { $$slots, $$events, ...props } = $$props;
		const [path, labelX, labelY] = getBezierPath(props);
		BaseEdge($$renderer, {
			path,
			animated: true,
			style: "stroke:#f59e0b;stroke-width:2"
		});
		$$renderer.push(`<!----> `);
		EdgeLabel($$renderer, {
			children: ($$renderer) => {
				$$renderer.push(`<div class="nodrag nopan absolute rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 shadow"${attr_style(`transform: translate(-50%, -50%) translate(${labelX}px,${labelY}px);`)}>${escape_html(String(props.label ?? ""))}</div>`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!---->`);
	});
}
//#endregion
//#region src/lib/actor-graph/ActorGraph.svelte
function ActorGraph($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let nodes = [];
		let edges = [];
		const nodeTypes = { actor: ActorNode };
		const edgeTypes = { message: MessageEdge };
		$$renderer.push(`<div class="h-[calc(100vh-7rem)] w-full rounded-xl border border-border/50 bg-background/70">`);
		SvelteFlow($$renderer, {
			nodes,
			edges,
			nodeTypes,
			edgeTypes,
			fitView: true,
			children: ($$renderer) => {
				Background($$renderer, {});
				$$renderer.push(`<!----> `);
				Controls($$renderer, {});
				$$renderer.push(`<!---->`);
			},
			$$slots: { default: true }
		});
		$$renderer.push(`<!----></div>`);
	});
}
//#endregion
//#region src/routes/debug/actors/+page.svelte
function _page($$renderer) {
	head("n6i2yf", $$renderer, ($$renderer) => {
		$$renderer.title(($$renderer) => {
			$$renderer.push(`<title>Actor debug graph — AvenOS</title>`);
		});
	});
	$$renderer.push(`<section class="mx-auto flex w-full max-w-[96rem] flex-col gap-4 px-4 py-4"><div><p class="text-[10px] font-bold uppercase tracking-[0.26em] opacity-40">Debug</p> <h1 class="text-xl font-semibold tracking-tight">Actors</h1> <p class="text-sm opacity-60">Live runtime topology with ownership edges and transient message flows.</p></div> `);
	ActorGraph($$renderer, {});
	$$renderer.push(`<!----></section>`);
}
//#endregion
export { _page as default };
