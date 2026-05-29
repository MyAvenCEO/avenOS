import "../../../../chunks/index-server.js";
import { H as attr, U as clsx, W as escape_html, a as ensure_array_like, i as derived, l as stringify, n as attr_class, o as head } from "../../../../chunks/dev.js";
import { n as workspaceOrchestratorClass } from "../../../../chunks/layout.js";
//#region src/lib/intent-mock/skill-display.ts
/** Primary = catalog path (e.g. `ingest/receipt_normalize`); secondary = id (e.g. `sk-ingest`). */
function skillLinesForBinding(b) {
	return {
		primary: b.name,
		secondary: b.skillId
	};
}
function skillLinesForSubAgent(sa, skills) {
	if (sa.skillId) {
		const b = skills.find((s) => s.skillId === sa.skillId);
		if (b) return skillLinesForBinding(b);
	}
	return {
		primary: sa.role,
		secondary: sa.name
	};
}
//#endregion
//#region src/lib/intent-mock/involved-actors-display.ts
/**
* Filter activity rows for the Overview log (skill-scoped).
* Slot index aligns with {@link MOCK_INVOLVED_ACTORS} order.
*/
function activityMatchesActorFilter(intent, activity, actorId) {
	const row = actorSelectionRowForId(intent, actorId);
	if (!row) return true;
	if (activity.actorIds?.some((id) => row.runtimeActorIds.includes(id))) return true;
	if (activity.agentId && row.runtimeActorIds.includes(activity.agentId)) return true;
	if (row.id === `intent/${intent.id}`) return activity.kind === "orchestrator" || activity.kind === "human" || activity.kind === "hitl";
	if (row.id === "dispatcher") return activity.kind === "delegation";
	return false;
}
function statusForOrchestrator(intent) {
	if (intent.done) return "done";
	return "orchestrating";
}
/** Short label for the small status pill under each actor name. */
function statusBadgeLabel(status) {
	switch (status) {
		case "orchestrating": return "Leading";
		case "idle": return "Idle";
		case "running": return "Running";
		case "blocked_hitl": return "Blocked";
		case "done": return "Done";
		default: return "Idle";
	}
}
/**
* Mock faces + live skill names / statuses derived from the current intent.
* Order: AvenCEO → supervisor(s) → workers (see {@link MOCK_INVOLVED_ACTORS} tiers).
*/
function involvedActorsForIntent(intent) {
	const rows = [{
		id: `intent/${intent.id}`,
		label: "Intent",
		skillName: intent.orchestratorLabel,
		tier: "orchestrator",
		status: statusForOrchestrator(intent),
		runtimeActorIds: [`intent/${intent.id}`]
	}, {
		id: "dispatcher",
		label: "Dispatcher",
		skillName: "Dispatch",
		tier: "supervisor",
		status: intent.done ? "done" : "running",
		runtimeActorIds: ["dispatcher"]
	}];
	for (const sub of intent.subAgents) {
		const lines = skillLinesForSubAgent(sub, intent.skills);
		rows.push({
			id: sub.id,
			label: sub.name,
			skillName: lines.primary,
			tier: "worker",
			status: sub.status,
			runtimeActorIds: [sub.name, sub.id].filter((value, index, all) => value.length > 0 && all.indexOf(value) === index)
		});
	}
	const known = new Set(rows.flatMap((row) => row.runtimeActorIds));
	for (const activity of intent.activity) for (const actorRef of activity.actorIds ?? []) {
		if (known.has(actorRef) || actorRef === `intent/${intent.id}`) continue;
		known.add(actorRef);
		rows.push({
			id: actorRef,
			label: actorRef,
			skillName: prettifyActorLabel(actorRef),
			tier: actorRef === "dispatcher" ? "supervisor" : "worker",
			status: "running",
			runtimeActorIds: [actorRef]
		});
	}
	return rows;
}
function runtimeActorIdsForSelection(intent, actorId) {
	return actorSelectionRowForId(intent, actorId)?.runtimeActorIds ?? [];
}
function actorSelectionRowForId(intent, actorId) {
	return involvedActorsForIntent(intent).find((row) => row.id === actorId);
}
function prettifyActorLabel(actorId) {
	return actorId.replace(/^intent\//, "Intent ").replaceAll(/[-_]/g, " ").trim();
}
//#endregion
//#region src/lib/intent-mock/IntentActorColumn.svelte
function IntentActorColumn($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { intent, selectedActorId, onSelectActor } = $$props;
		const rows = derived(() => involvedActorsForIntent(intent));
		function showDividerAfter(prev, row) {
			return prev.tier !== row.tier;
		}
		/** State dots — richer greens / amber / orange / grey (higher chroma, still UI-soft). */
		function statusDotClass(status) {
			const shell = "size-2.5 shrink-0 rounded-full ring-2 ring-background shadow-sm";
			switch (status) {
				case "blocked_hitl": return `${shell} bg-orange-400`;
				case "running": return `${shell} bg-amber-300`;
				case "orchestrating": return `${shell} bg-emerald-400`;
				case "done": return `${shell} bg-green-500`;
				default: return `${shell} bg-stone-500`;
			}
		}
		function itemClass(isOn) {
			const base = "group w-full cursor-pointer rounded-lg border text-left transition-colors duration-150 ease-out px-2 py-1.5";
			return isOn ? `${base} border-foreground/20 bg-background/90` : `${base} border-border/40 bg-background/40 hover:bg-background/70`;
		}
		$$renderer.push(`<section class="flex h-full min-h-0 w-full max-w-31 min-w-0 flex-col border-l border-border/50 pl-2"><div class="mb-1.5 flex shrink-0 items-center gap-2"><span class="text-[9px] font-bold uppercase tracking-[0.26em] opacity-30">Skills</span></div> <nav class="scrollbar-gutter-stable flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden pr-0.5" aria-label="Select skill"><!--[-->`);
		const each_array = ensure_array_like(rows());
		for (let i = 0, $$length = each_array.length; i < $$length; i++) {
			let row = each_array[i];
			if (i > 0 && showDividerAfter(rows()[i - 1], row)) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<div class="my-1 h-px shrink-0 bg-border/60" role="separator" aria-hidden="true"></div>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <button type="button"${attr_class(clsx(itemClass(selectedActorId === row.id)))}${attr("title", `${row.skillName} · ${statusBadgeLabel(row.status)}`)}${attr("aria-pressed", selectedActorId === row.id)}${attr("aria-label", `Skill ${row.skillName}, ${statusBadgeLabel(row.status)}`)}><div class="flex items-center gap-2"><span${attr_class(clsx(statusDotClass(row.status)))} aria-hidden="true"></span> <p class="min-w-0 flex-1 text-[11px] font-semibold leading-snug tracking-tight text-foreground/90 line-clamp-2">${escape_html(row.skillName)}</p></div></button>`);
		}
		$$renderer.push(`<!--]--></nav></section>`);
	});
}
//#endregion
//#region src/lib/intent-mock/ceo-copy.ts
var AVENCEO_NAME = "AvenCEO";
function sidebarIntentPhase(intent) {
	if (intent.done) return {
		phase: "done",
		label: "Done"
	};
	if (intent.hitlTodos.some((t) => t.status === "open") || intent.subAgents.some((s) => s.status === "blocked_hitl")) return {
		phase: "human_review",
		label: "Human Review"
	};
	if (intent.isActivelyWorkedOn || intent.subAgents.some((s) => s.status === "running")) return {
		phase: "working",
		label: "Working"
	};
	return {
		phase: "open",
		label: "Queued"
	};
}
function sidebarStatusBadgeClass(phase) {
	switch (phase) {
		case "done": return "bg-foreground/10 text-foreground/65";
		case "human_review": return "bg-amber-500/15 text-amber-950 ring-1 ring-amber-500/25";
		case "working": return "bg-sky-500/10 text-sky-950 ring-1 ring-sky-500/20";
		case "open": return "bg-foreground/[0.04] text-foreground/55 ring-1 ring-border/55";
	}
}
var STREAM_KIND_LABEL = {
	human: "You",
	orchestrator: AVENCEO_NAME,
	sub_agent: "Skill",
	delegation: "Update",
	hitl: "Human Review",
	tool: "Progress"
};
function activityStreamKindLabel(kind) {
	return STREAM_KIND_LABEL[kind];
}
//#endregion
//#region src/lib/intent-mock/hitl/TodoApproveReject.svelte
function TodoApproveReject($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { todo, onDecide } = $$props;
		$$renderer.push(`<div class="tech-card flex flex-col gap-3 p-4 border-dashed border-foreground/20"><p class="text-xs font-bold uppercase opacity-40 tracking-wider">${escape_html(todo.title)}</p> <p class="text-sm leading-relaxed opacity-90">${escape_html(todo.summary)}</p> <div class="flex gap-2"><button type="button" class="px-4 py-1.5 rounded-full bg-foreground text-background text-[10px] font-bold uppercase">Approve</button> <button type="button" class="px-4 py-1.5 rounded-full border border-border text-[10px] font-bold uppercase hover:bg-foreground hover:text-background transition-colors">Reject</button></div></div>`);
	});
}
//#endregion
//#region src/lib/intent-mock/hitl/TodoChoice.svelte
function TodoChoice($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { todo, onPick } = $$props;
		$$renderer.push(`<div class="tech-card flex flex-col gap-3 p-4 border-dashed border-foreground/20"><p class="text-xs font-bold uppercase opacity-40 tracking-wider">${escape_html(todo.title)}</p> <p class="text-sm leading-relaxed">${escape_html(todo.question)}</p> <div class="flex flex-col gap-2"><!--[-->`);
		const each_array = ensure_array_like(todo.options);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let opt = each_array[$$index];
			$$renderer.push(`<button type="button" class="text-left rounded-lg border border-border px-3 py-2 text-sm hover:bg-foreground/5 transition-colors">${escape_html(opt.label)}</button>`);
		}
		$$renderer.push(`<!--]--></div></div>`);
	});
}
//#endregion
//#region src/lib/intent-mock/hitl/TodoTextReply.svelte
function TodoTextReply($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { todo, onSubmit } = $$props;
		$$renderer.push(`<div class="tech-card flex flex-col gap-3 p-4 border-dashed border-foreground/20"><p class="text-xs font-bold uppercase opacity-40 tracking-wider">${escape_html(todo.title)}</p> <p class="text-sm leading-relaxed">${escape_html(todo.question)}</p> <input${attr("value", "")}${attr("placeholder", todo.placeholder)} class="w-full rounded-lg border border-border bg-background/80 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-foreground/30"/> <button type="button" class="self-start px-4 py-1.5 rounded-full border border-border text-[10px] font-bold uppercase hover:bg-foreground hover:text-background transition-colors">Send to supervisor</button></div>`);
	});
}
//#endregion
//#region src/lib/intent-mock/HitlTodoHost.svelte
function HitlTodoHost($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { todos, onResolve } = $$props;
		const openTodos = derived(() => todos.filter((t) => t.status === "open"));
		if (openTodos().length === 0) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<p class="text-xs opacity-40 py-2">Nothing needs your input right now. When something does, it will show up here.</p>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<div class="space-y-4"><!--[-->`);
			const each_array = ensure_array_like(openTodos());
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let todo = each_array[$$index];
				if (todo.type === "text_reply") {
					$$renderer.push("<!--[0-->");
					TodoTextReply($$renderer, {
						todo,
						onSubmit: (text) => onResolve(todo.id, {
							kind: "text_reply",
							text
						})
					});
				} else if (todo.type === "choice") {
					$$renderer.push("<!--[1-->");
					TodoChoice($$renderer, {
						todo,
						onPick: (optionId) => onResolve(todo.id, {
							kind: "choice",
							optionId
						})
					});
				} else if (todo.type === "approve_reject") {
					$$renderer.push("<!--[2-->");
					TodoApproveReject($$renderer, {
						todo,
						onDecide: (approved) => onResolve(todo.id, {
							kind: "approve_reject",
							approved
						})
					});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			}
			$$renderer.push(`<!--]--></div>`);
		}
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
//#region src/lib/intent-mock/IntentCenterPanel.svelte
function IntentCenterPanel($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { intent, panel, selectedActorId, onResolveHitl } = $$props;
		const filteredActivity = derived(() => {
			if (!intent || panel !== "overview") return [];
			return intent.activity.filter((row) => activityMatchesActorFilter(intent, row, selectedActorId));
		});
		/** Human review (HITL) on the lead skill; in dev, static layout examples are appended. */
		const showHitlOnOverview = derived(() => {
			if (!intent || selectedActorId !== `intent/${intent.id}`) return false;
			const openTodos = intent.hitlTodos.some((t) => t.status === "open");
			const blocked = intent.subAgents.some((s) => s.status === "blocked_hitl");
			return openTodos || blocked;
		});
		$$renderer.push(`<div class="min-w-0 flex flex-1 flex-col min-h-0 gap-3 overflow-hidden">`);
		if (!intent) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border/60 p-12"><p class="text-sm opacity-40 text-center max-w-sm">Choose an intent on the left to see what ${escape_html(AVENCEO_NAME)} and your skills are doing, and when
				your input is needed.</p></div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<div class="min-w-0 shrink-0"><div class="flex shrink-0 items-center gap-2 mb-1.5 min-w-0"><span class="text-[9px] font-bold uppercase tracking-[0.26em] opacity-30">${escape_html(AVENCEO_NAME)}</span></div> <div class="min-w-0 space-y-1"><h1 class="text-[15px] sm:text-base font-semibold tracking-tight leading-snug">${escape_html(intent.title)}</h1> <p class="text-[11px] opacity-55 leading-snug line-clamp-2 max-w-2xl">${escape_html(intent.summary)}</p></div></div> <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain pr-2 scrollbar-gutter-stable pb-8">`);
			if (panel === "overview") {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<section class="max-w-2xl space-y-5">`);
				if (showHitlOnOverview()) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<div class="space-y-2"><p class="text-[9px] font-bold uppercase tracking-[0.26em] opacity-30">Human review</p> `);
					HitlTodoHost($$renderer, {
						todos: intent.hitlTodos,
						onResolve: onResolveHitl
					});
					$$renderer.push(`<!----></div>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> <div class="min-w-0 space-y-2"><p class="text-[9px] font-bold uppercase tracking-[0.26em] opacity-30">Activity</p> `);
				if (filteredActivity().length === 0) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<p class="py-3 text-center text-[11px] opacity-45">${escape_html(intent.activity.length === 0 ? "No activity yet." : "No activity for this skill.")}</p>`);
				} else {
					$$renderer.push("<!--[-1-->");
					$$renderer.push(`<ol class="divide-y divide-border/20 space-y-0"><!--[-->`);
					const each_array = ensure_array_like(filteredActivity());
					for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
						let row = each_array[$$index];
						const sa = row.agentId !== void 0 ? intent.subAgents.find((s) => s.id === row.agentId) : void 0;
						const skillLines = sa ? skillLinesForSubAgent(sa, intent.skills) : null;
						$$renderer.push(`<li class="flex gap-2 py-2.5 text-[12px] leading-snug first:pt-0"><span class="w-9 shrink-0 pt-0.5 font-mono text-[9px] tabular-nums opacity-35">${escape_html(row.at)}</span> <div class="min-w-0 flex-1"><span class="text-[9px] font-bold uppercase tracking-wide opacity-40">${escape_html(activityStreamKindLabel(row.kind))}</span> `);
						if (skillLines) {
							$$renderer.push("<!--[0-->");
							$$renderer.push(`<p class="mt-0.5 text-[12px] font-medium leading-snug">${escape_html(skillLines.primary)}</p> <p class="mt-0.5 font-mono text-[9px] opacity-40">${escape_html(skillLines.secondary)}</p>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--> <p${attr_class(`font-medium text-[12px] leading-snug ${stringify(skillLines ? "mt-1" : "mt-0.5")}`)}>${escape_html(row.title)}</p> `);
						if (row.detail) {
							$$renderer.push("<!--[0-->");
							$$renderer.push(`<p class="mt-1 text-[11px] leading-relaxed opacity-60">${escape_html(row.detail)}</p>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--></div></li>`);
					}
					$$renderer.push(`<!--]--></ol>`);
				}
				$$renderer.push(`<!--]--></div></section>`);
			} else if (panel === "config") {
				$$renderer.push("<!--[1-->");
				$$renderer.push(`<section class="max-w-2xl"><div class="tech-card space-y-4 p-3 sm:p-4"><div><p class="text-[10px] font-bold uppercase opacity-40 tracking-wide mb-2">Tools</p> <ul class="text-sm space-y-2 opacity-90"><li class="flex justify-between gap-3 border-b border-border/20 pb-2"><span class="font-mono text-xs">read_workspace_file</span> <span class="text-[10px] uppercase text-emerald-800 font-bold">On</span></li> <li class="flex justify-between gap-3 border-b border-border/20 pb-2"><span class="font-mono text-xs">delegate_to_skill</span> <span class="text-[10px] uppercase text-emerald-800 font-bold">On</span></li> <li class="flex justify-between gap-3"><span class="font-mono text-xs">sandbox_exec</span> <span class="text-[10px] uppercase opacity-40 font-bold">Off</span></li></ul></div> <div><p class="text-[10px] font-bold uppercase opacity-40 tracking-wide mb-2">LLM</p> <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm"><dt class="opacity-45">Model</dt> <dd class="font-mono text-xs">glm-5-1 · structured</dd> <dt class="opacity-45">Temperature</dt> <dd class="font-mono text-xs">0.2 (mock)</dd> <dt class="opacity-45">Skill</dt> <dd class="font-mono text-xs">${escape_html(intent.orchestratorLabel)}</dd></dl></div></div></section>`);
			} else {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<section class="max-w-2xl space-y-3"><details class="tech-card group" open=""><summary class="cursor-pointer list-none px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between gap-2 text-sm font-semibold tracking-tight marker:content-none">SOUL.md <span class="text-[10px] font-bold uppercase opacity-35 group-open:rotate-180 transition-transform">▾</span></summary> <div class="px-3 pb-3 sm:px-4 sm:pb-4 text-xs opacity-75 leading-relaxed border-t border-border/30 pt-3 font-mono">You are a careful specialist under ${escape_html(AVENCEO_NAME)}. Prefer small, verifiable steps. Ask
								the human when policy is unclear.</div></details> <details class="tech-card group"><summary class="cursor-pointer list-none px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between gap-2 text-sm font-semibold tracking-tight marker:content-none">Workspace rules <span class="text-[10px] font-bold uppercase opacity-35 group-open:rotate-180 transition-transform">▾</span></summary> <div class="px-3 pb-3 sm:px-4 sm:pb-4 text-xs opacity-75 leading-relaxed border-t border-border/30 pt-3 font-mono">— Never exfiltrate secrets.<br/> — Cite file paths when claiming facts.<br/> — Escalate blocked HITL items with a one-line reason.</div></details> <details class="tech-card group"><summary class="cursor-pointer list-none px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between gap-2 text-sm font-semibold tracking-tight marker:content-none">Skill bindings (preview) <span class="text-[10px] font-bold uppercase opacity-35 group-open:rotate-180 transition-transform">▾</span></summary> <ul class="px-3 pb-3 sm:px-4 sm:pb-4 space-y-2 border-t border-border/30 pt-3"><!--[-->`);
				const each_array_1 = ensure_array_like(intent.skills);
				for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
					let s = each_array_1[$$index_1];
					const lines = skillLinesForBinding(s);
					$$renderer.push(`<li class="text-sm"><p class="font-medium leading-snug">${escape_html(lines.primary)}</p> <p class="font-mono text-[10px] opacity-40 mt-0.5">${escape_html(lines.secondary)}</p></li>`);
				}
				$$renderer.push(`<!--]--></ul></details></section>`);
			}
			$$renderer.push(`<!--]--></div>`);
		}
		$$renderer.push(`<!--]--></div>`);
	});
}
//#endregion
//#region src/lib/intent-mock/IntentLeftNav.svelte
function IntentLeftNav($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { intents, selectedId, onSelect, onRemove } = $$props;
		$$renderer.push(`<section class="min-w-0 flex flex-col min-h-0"><div class="flex shrink-0 items-center gap-2 mb-1.5"><span class="text-[9px] font-bold uppercase tracking-[0.26em] opacity-30">Intents</span></div> <div class="flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto pr-0.5">`);
		const each_array = ensure_array_like(intents);
		if (each_array.length !== 0) {
			$$renderer.push("<!--[-->");
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let intent = each_array[$$index];
				const { phase, label } = sidebarIntentPhase(intent);
				$$renderer.push(`<div role="button" tabindex="0"${attr_class(`group w-full text-left cursor-pointer rounded-lg border px-3 py-2 transition-colors duration-150 ease-out ${stringify(selectedId === intent.id ? "border-foreground/20 bg-background/90" : "border-border/40 bg-background/40 hover:bg-background/70")}`)}><div class="flex items-start gap-2"><div class="min-w-0 flex-1 space-y-0.5 pr-0.5"><p${attr_class(`text-[13px] font-semibold tracking-tight leading-tight line-clamp-2 ${stringify(intent.done ? "opacity-35 line-through" : "")}`)}>${escape_html(intent.title)}</p> <p class="text-[10px] opacity-50 leading-snug line-clamp-1">${escape_html(intent.summary)}</p></div> <div class="shrink-0 flex flex-col items-end justify-center gap-1 self-stretch w-min min-w-17 pt-0.5"><span${attr_class(`inline-flex rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-center leading-none ${stringify(sidebarStatusBadgeClass(phase))}`)}>${escape_html(label)}</span></div> <div class="shrink-0 -mr-0.5 -mt-0.5" role="group"><button type="button" class="opacity-0 group-hover:opacity-100 transition-opacity rounded-full p-1 text-foreground/45 hover:bg-foreground/5 hover:text-error" aria-label="Remove intent"><svg class="size-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg></button></div></div></div>`);
			}
		} else {
			$$renderer.push("<!--[!-->");
			$$renderer.push(`<p class="text-[11px] opacity-40 py-3">No intents yet. Use the composer below.</p>`);
		}
		$$renderer.push(`<!--]--></div></section>`);
	});
}
//#endregion
//#region src/lib/intent-mock/IntentRightRail.svelte
function IntentRightRail($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { tabs, tab, onTab } = $$props;
		$$renderer.push(`<aside class="flex min-h-0 w-max max-w-none shrink-0 flex-col"><div class="flex w-full shrink-0 items-center justify-end gap-2 mb-1.5"><span class="text-[9px] font-bold uppercase tracking-[0.26em] opacity-30">Views</span></div> <nav class="scrollbar-gutter-stable flex max-h-full min-h-0 w-max flex-col items-end gap-0.5 overflow-y-auto" aria-label="Skill views"><!--[-->`);
		const each_array = ensure_array_like(tabs);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let item = each_array[$$index];
			$$renderer.push(`<button type="button"${attr_class(`rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-tight transition-colors whitespace-nowrap w-fit max-w-none ${stringify(tab === item.id ? "bg-foreground text-background" : "opacity-45 hover:opacity-90 hover:bg-foreground/5")}`)}>${escape_html(item.label)}</button>`);
		}
		$$renderer.push(`<!--]--></nav></aside>`);
	});
}
//#endregion
//#region src/lib/intent-mock/SelectedActorDetails.svelte
function SelectedActorDetails($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { intent, selectedActorId } = $$props;
		let snapshot = { actors: [] };
		let details = {};
		const runtimeActorIds = derived(() => intent ? runtimeActorIdsForSelection(intent, selectedActorId) : []);
		const selectedItems = derived(() => {
			return runtimeActorIds().flatMap((actorId) => details[actorId] ?? []).sort((a, b) => a.id.localeCompare(b.id)).slice(-40).reverse();
		});
		const selectedSnapshotActors = derived(() => runtimeActorIds().map((actorId) => snapshot.actors.find((actor) => actor.id === actorId)).filter((actor) => Boolean(actor)));
		$$renderer.push(`<section class="min-h-0 flex flex-1 flex-col"><div class="mb-1.5 flex items-center justify-between gap-2"><span class="text-[9px] font-bold uppercase tracking-[0.26em] opacity-30">Skills</span> <span class="text-[9px] opacity-40">selected actor trace</span></div> `);
		if (!intent) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<p class="py-3 text-[11px] opacity-40">Select an intent to inspect actor details.</p>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<div class="mb-2 space-y-1 rounded-lg border border-border/40 bg-background/40 px-2.5 py-2">`);
			const each_array = ensure_array_like(selectedSnapshotActors());
			if (each_array.length !== 0) {
				$$renderer.push("<!--[-->");
				for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
					let actor = each_array[$$index];
					$$renderer.push(`<div><p class="text-[11px] font-semibold leading-tight">${escape_html(actor.name)}</p> <p class="font-mono text-[9px] opacity-45">${escape_html(actor.id)}</p> <p class="mt-0.5 text-[10px] opacity-60">${escape_html(actor.status)} · mailbox ${escape_html(actor.mailboxDepth)}${escape_html(actor.currentTask ? ` · ${actor.currentTask}` : "")}</p></div>`);
				}
			} else {
				$$renderer.push("<!--[!-->");
				$$renderer.push(`<p class="text-[11px] opacity-45">No live runtime actor mapped for this selection yet.</p>`);
			}
			$$renderer.push(`<!--]--></div> <div class="min-h-0 flex-1 overflow-y-auto pr-0.5">`);
			if (selectedItems().length === 0) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<p class="py-3 text-[11px] opacity-40">No detailed runtime events yet.</p>`);
			} else {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<ol class="space-y-2"><!--[-->`);
				const each_array_1 = ensure_array_like(selectedItems());
				for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
					let item = each_array_1[$$index_1];
					$$renderer.push(`<li class="rounded-lg border border-border/35 bg-background/35 px-2.5 py-2"><div class="flex items-start justify-between gap-2"><div class="min-w-0"><p class="text-[10px] font-bold uppercase tracking-wide opacity-40">${escape_html(item.kind)}</p> <p class="text-[11px] font-semibold leading-snug break-words">${escape_html(item.title)}</p></div> <span class="font-mono text-[9px] opacity-35">${escape_html(item.at)}</span></div> `);
					if (item.meta) {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<p class="mt-1 font-mono text-[9px] opacity-40 break-all">${escape_html(item.meta)}</p>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					if (item.detail) {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<pre class="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed opacity-65">${escape_html(item.detail)}</pre>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--></li>`);
				}
				$$renderer.push(`<!--]--></ol>`);
			}
			$$renderer.push(`<!--]--></div>`);
		}
		$$renderer.push(`<!--]--></section>`);
	});
}
//#endregion
//#region src/lib/intent-mock/actor-context-tabs.ts
/** Declarative tab sets per tier — later this can load from JSON/config. */
var ACTOR_CONTEXT_TAB_DEFS = {
	orchestrator: [
		{
			id: "overview",
			label: "Overview"
		},
		{
			id: "config",
			label: "Config"
		},
		{
			id: "context",
			label: "Context"
		}
	],
	supervisor: [
		{
			id: "overview",
			label: "Overview"
		},
		{
			id: "config",
			label: "Config"
		},
		{
			id: "context",
			label: "Context"
		}
	],
	worker: [{
		id: "overview",
		label: "Overview"
	}, {
		id: "config",
		label: "Config"
	}]
};
function contextTabsForTier(tier) {
	return ACTOR_CONTEXT_TAB_DEFS[tier];
}
//#endregion
//#region src/lib/jaensen/api.ts
async function expectJson(response) {
	if (!response.ok) {
		let message = `Request failed (${response.status})`;
		const body = await response.json().catch(() => null);
		if (body?.error) message = body.error;
		const error = new Error(message);
		console.error("[aven-ceo][jaensen][api] request failed", {
			status: response.status,
			statusText: response.statusText,
			message,
			url: response.url
		});
		throw error;
	}
	return await response.json();
}
async function postMessage(input) {
	return expectJson(await fetch("/api/aven/jaensen/messages", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input)
	}));
}
async function listIntents() {
	return (await expectJson(await fetch("/api/aven/jaensen/intents"))).intents;
}
async function getIntent(intentId) {
	return expectJson(await fetch(`/api/aven/jaensen/intents/${encodeURIComponent(intentId)}`));
}
async function getEvents(scope, after) {
	const url = new URL("/api/aven/jaensen/events", window.location.origin);
	url.searchParams.set("scope", scope);
	if (after && after > 0) url.searchParams.set("after", String(after));
	return (await expectJson(await fetch(url))).events.map((event) => ({
		seq: event.seq,
		scope: event.scope,
		type: event.type,
		payload: event.payload,
		createdAt: event.createdAt,
		envelopeId: event.envelopeId
	}));
}
//#endregion
//#region src/lib/jaensen/types.ts
var STREAM_EVENT_TYPES = [
	"intent.created",
	"intent.status_changed",
	"intent.skill_call_started",
	"intent.skill_call_completed",
	"intent.message_to_user",
	"skill.worker_spawned",
	"skill.worker_routed",
	"skill.worker_completed",
	"runtime.envelope.completed",
	"runtime.envelope.queued",
	"runtime.envelope.claimed",
	"runtime.envelope.failed",
	"actor.event"
];
//#endregion
//#region src/lib/jaensen/sse.ts
function subscribeToScope(scope, options) {
	const url = new URL("/api/aven/jaensen/events/stream", window.location.origin);
	url.searchParams.set("scope", scope);
	if (options.afterSeq && options.afterSeq > 0) url.searchParams.set("after", String(options.afterSeq));
	const source = new EventSource(url);
	for (const type of STREAM_EVENT_TYPES) source.addEventListener(type, (raw) => {
		const event = raw;
		const parsed = JSON.parse(event.data);
		options.onEvent({
			seq: typeof parsed?.seq === "number" ? parsed.seq : Number.parseInt(event.lastEventId || "0", 10) || 0,
			scope: typeof parsed?.scope === "string" ? parsed.scope : scope,
			type: typeof parsed?.type === "string" ? parsed.type : type,
			payload: "payload" in parsed ? parsed.payload : parsed,
			createdAt: typeof parsed?.createdAt === "string" ? parsed.createdAt : void 0,
			envelopeId: typeof parsed?.envelopeId === "string" || parsed?.envelopeId === null ? parsed.envelopeId : void 0
		});
	});
	source.onerror = (error) => options.onError?.(error);
	return source;
}
//#endregion
//#region src/lib/jaensen/intent-store.svelte.ts
var ACTIVE_ENVELOPE_EVENT_TYPES = new Set([
	"runtime.envelope.queued",
	"runtime.envelope.claimed",
	"runtime.envelope.completed",
	"runtime.envelope.failed",
	"intent.skill_call_started",
	"intent.skill_call_completed",
	"skill.worker_spawned",
	"skill.worker_routed",
	"skill.worker_completed",
	"actor.event"
]);
var STORAGE_PREFIX = "aven-ceo:jaensen:last-seq:";
function logJaensenError(context, error) {
	console.error(`[aven-ceo][jaensen] ${context}`, error);
}
var IntentStore = class {
	intents = {};
	orderedIntentIds = [];
	selectedIntentId = null;
	loading = false;
	error = null;
	streams = /* @__PURE__ */ new Map();
	booted = false;
	selectedIntent() {
		return this.selectedIntentId ? toIntentOrchestrator(this.intents[this.selectedIntentId] ?? null) : null;
	}
	intentList() {
		return this.orderedIntentIds.map((id) => toIntentOrchestrator(this.intents[id] ?? null)).filter((value) => value !== null);
	}
	async init() {
		if (this.booted) return;
		this.booted = true;
		this.loading = true;
		this.error = null;
		try {
			const summaries = await listIntents();
			const intents = await Promise.all(summaries.map((intent) => this.hydrateIntent(intent.id)));
			this.orderedIntentIds = sortIntentIds(intents);
			if (!this.selectedIntentId) this.selectedIntentId = this.orderedIntentIds[0] ?? null;
		} catch (error) {
			logJaensenError("IntentStore.init failed", error);
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
		}
	}
	selectIntent(intentId) {
		this.selectedIntentId = intentId;
	}
	removeIntent(intentId) {
		this.closeIntentStreams(intentId);
		const next = { ...this.intents };
		delete next[intentId];
		this.intents = next;
		this.orderedIntentIds = this.orderedIntentIds.filter((id) => id !== intentId);
		if (this.selectedIntentId === intentId) this.selectedIntentId = this.orderedIntentIds[0] ?? null;
	}
	async sendMessage(text, options) {
		const result = await postMessage({
			text,
			intentIdHint: options?.intentIdHint,
			attachments: options?.attachment ? [options.attachment] : []
		});
		if (options?.intentIdHint && options?.resolvedQuestionId) this.markQuestionResolved(options.intentIdHint, options.resolvedQuestionId);
		this.subscribe(`correlation/${result.correlationId}`);
		return result;
	}
	async hydrateIntent(intentId) {
		const snapshot = await getIntent(intentId);
		let state = mergeSnapshot(createEmptyIntentView(intentId), snapshot);
		const scope = `intent/${intentId}`;
		const events = await getEvents(scope);
		for (const event of events) state = reduceIntentEvent(state, event);
		this.writeIntent(state);
		if (state.status === "active" || state.status === "waiting_for_user") this.subscribe(scope);
		return state;
	}
	subscribe(scope) {
		if (typeof window === "undefined" || this.streams.has(scope)) return;
		const source = subscribeToScope(scope, {
			afterSeq: this.readStoredLastSeq(scope),
			onEvent: (event) => this.apply(event),
			onError: (error) => {
				logJaensenError(`SSE error for scope ${scope}`, error);
			}
		});
		this.streams.set(scope, source);
	}
	apply(event) {
		const payload = toRecord(event.payload);
		const intentId = inferIntentIdFromPayload(payload);
		if (event.type === "intent.created" && intentId) {
			const next = reduceIntentEvent(this.intents[intentId] ?? createEmptyIntentView(intentId), event);
			this.writeIntent(next);
			this.subscribe(`intent/${intentId}`);
			this.closeCorrelationScope(event, payload);
			if (!this.selectedIntentId) this.selectedIntentId = intentId;
			return;
		}
		if (!intentId) return;
		const intentScope = `intent/${intentId}`;
		if (event.scope.startsWith("correlation/") && this.streams.has(intentScope)) {
			this.closeScope(event.scope);
			return;
		}
		const next = reduceIntentEvent(this.intents[intentId] ?? createEmptyIntentView(intentId), event);
		this.writeIntent(next);
		if (next.status === "active" || next.status === "waiting_for_user") this.subscribe(intentScope);
		this.closeCorrelationScope(event, payload);
		if (next.status === "completed" || next.status === "failed") this.closeScope(intentScope);
	}
	writeIntent(intent) {
		this.intents = {
			...this.intents,
			[intent.intentId]: intent
		};
		this.orderedIntentIds = sortIntentIds(Object.values(this.intents));
		for (const [scope, seq] of Object.entries(intent.lastSeqByScope)) this.storeLastSeq(scope, seq);
	}
	readStoredLastSeq(scope) {
		if (typeof localStorage === "undefined") return 0;
		const raw = localStorage.getItem(`${STORAGE_PREFIX}${scope}`);
		const parsed = Number.parseInt(raw ?? "0", 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
	}
	storeLastSeq(scope, seq) {
		if (typeof localStorage === "undefined" || !(seq > 0)) return;
		localStorage.setItem(`${STORAGE_PREFIX}${scope}`, String(seq));
	}
	closeScope(scope) {
		const stream = this.streams.get(scope);
		if (!stream) return;
		stream.close();
		this.streams.delete(scope);
	}
	closeIntentStreams(intentId) {
		this.closeScope(`intent/${intentId}`);
		for (const scope of [...this.streams.keys()]) if (scope.includes(intentId)) this.closeScope(scope);
	}
	closeCorrelationScope(event, payload) {
		if (event.scope.startsWith("correlation/")) {
			this.closeScope(event.scope);
			return;
		}
		const correlationId = inferCorrelationIdFromPayload(payload);
		if (!correlationId) return;
		this.closeScope(`correlation/${correlationId}`);
	}
	markQuestionResolved(intentId, questionId) {
		const intent = this.intents[intentId];
		if (!intent) return;
		const nextQuestions = intent.questions.map((question) => question.id === questionId ? {
			...question,
			resolved: true
		} : question);
		if (nextQuestions === intent.questions) return;
		this.writeIntent({
			...intent,
			questions: nextQuestions
		});
	}
};
function reduceIntentEvent(state, event) {
	const payload = toRecord(event.payload);
	if (!matchesIntent(state.intentId, payload)) return updateSeq(state, event);
	switch (event.type) {
		case "intent.created":
		case "intent.status_changed": return applyIntentStatus(updateSeq(state, event), payload, event);
		case "runtime.envelope.queued": return applyRuntimeEnvelopeQueued(updateSeq(state, event), payload, event);
		case "runtime.envelope.claimed": return applyRuntimeEnvelopeClaimed(updateSeq(state, event), payload, event);
		case "runtime.envelope.completed": return applyRuntimeEnvelopeCompleted(updateSeq(state, event), payload, event);
		case "runtime.envelope.failed": return applyRuntimeEnvelopeFailed(updateSeq(state, event), payload, event);
		case "intent.message_to_user": return applyMessageToUser(updateSeq(state, event), payload, event);
		case "actor.event": return applyActorEvent(updateSeq(state, event), payload, event);
		case "intent.skill_call_started": return applySkillCallStarted(updateSeq(state, event), payload, event);
		case "intent.skill_call_completed": return applySkillCallCompleted(updateSeq(state, event), payload, event);
		case "skill.worker_spawned":
		case "skill.worker_routed": return applyWorker(updateSeq(state, event), payload, event, event.type === "skill.worker_spawned" ? "spawned" : "routed");
		case "skill.worker_completed": return applyWorker(updateSeq(state, event), payload, event, "completed");
		default: return addDebugTimelineItem(updateSeq(state, event), event);
	}
}
function matchesIntent(intentId, payload) {
	const directIntentId = inferIntentIdFromPayload(payload);
	if (directIntentId) return directIntentId === intentId;
	const actorId = readString(payload.actorId);
	if (actorId) return actorId === `intent/${intentId}`;
	const toActor = readString(payload.toActor);
	if (toActor) return toActor === `intent/${intentId}`;
	return false;
}
function createEmptyIntentView(intentId) {
	return {
		intentId,
		title: "Untitled intent",
		status: "active",
		summary: "",
		lastActiveAt: void 0,
		messages: [],
		questions: [],
		skillCalls: {},
		workers: {},
		timeline: [],
		lastSeqByScope: {}
	};
}
function mergeSnapshot(state, snapshot) {
	const resolvedStatus = normalizeIntentStatus(snapshot.status) ?? state.status;
	const next = {
		...state,
		title: snapshot.title ?? state.title,
		status: resolvedStatus,
		summary: snapshot.summary ?? state.summary,
		createdAt: snapshot.createdAt ?? state.createdAt,
		updatedAt: snapshot.updatedAt ?? state.updatedAt
	};
	const pending = toRecord(snapshot.pendingSkillCalls);
	for (const [callId, rawCall] of Object.entries(pending)) {
		const call = toRecord(rawCall);
		next.skillCalls[callId] = {
			callId,
			skillId: readString(call.skillId) ?? "skill",
			request: readString(call.request) ?? "",
			status: "pending",
			startedAt: readString(call.createdAt) ?? next.updatedAt,
			updatedAt: next.updatedAt,
			metadata: call
		};
	}
	return next;
}
function updateSeq(state, event) {
	const nextCorrelationId = inferCorrelationIdFromPayload(toRecord(event.payload)) ?? state.correlationId;
	const nextLastActiveAt = ACTIVE_ENVELOPE_EVENT_TYPES.has(event.type) && nextCorrelationId ? event.createdAt ?? state.lastActiveAt : state.lastActiveAt;
	return {
		...state,
		updatedAt: event.createdAt ?? state.updatedAt,
		correlationId: nextCorrelationId,
		lastActiveAt: nextLastActiveAt,
		lastSeqByScope: {
			...state.lastSeqByScope,
			[event.scope]: Math.max(event.seq, state.lastSeqByScope[event.scope] ?? 0)
		}
	};
}
function applyIntentStatus(state, payload, event) {
	const next = {
		...state,
		title: readString(payload.title) ?? state.title,
		status: normalizeIntentStatus(payload.status) ?? state.status,
		summary: readString(payload.summary) ?? state.summary,
		updatedAt: event.createdAt ?? state.updatedAt
	};
	return appendTimeline(next, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: event.type === "intent.created" ? "Intent created" : `Status changed to ${next.status}`,
		detail: next.summary || void 0,
		at: event.createdAt,
		kind: "intent"
	});
}
function applyMessageToUser(state, payload, event) {
	if (readString(payload.messageType) === "human.question") {
		const questionText = readString(payload.question) ?? readString(payload.message) ?? "";
		const question = {
			id: `${state.intentId}:question:${event.seq}`,
			intentId: state.intentId,
			question: questionText,
			createdAt: event.createdAt,
			envelopeId: event.envelopeId,
			resolved: false,
			seq: event.seq
		};
		return appendTimeline({
			...state,
			questions: upsertQuestion(state.questions, question)
		}, {
			id: `${state.intentId}:${event.seq}`,
			seq: event.seq,
			type: event.type,
			title: "Question for you",
			detail: questionText,
			at: event.createdAt,
			kind: "question"
		});
	}
	const text = readString(payload.message) ?? "";
	const message = {
		id: `${state.intentId}:assistant:${event.seq}`,
		intentId: state.intentId,
		role: "assistant",
		text,
		createdAt: event.createdAt,
		envelopeId: event.envelopeId,
		seq: event.seq
	};
	return appendTimeline({
		...state,
		messages: upsertMessage(state.messages, message)
	}, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: "Assistant message",
		detail: text,
		at: event.createdAt,
		kind: "human"
	});
}
function applyActorEvent(state, payload, event) {
	const nested = toRecord(payload.event);
	const nestedType = readString(nested.type);
	if (nestedType === "intent.confirmation_requested" || nestedType === "ask.user") {
		const nestedPayload = toRecord(nested.payload);
		const assistantText = readString(nestedPayload.draftMessage) ?? readString(nestedPayload.message) ?? readString(nestedPayload.clarification);
		const nextState = assistantText ? {
			...state,
			messages: upsertMessage(state.messages, {
				id: `${state.intentId}:assistant:${event.seq}`,
				intentId: state.intentId,
				role: "assistant",
				text: assistantText,
				createdAt: event.createdAt,
				envelopeId: event.envelopeId,
				seq: event.seq
			})
		} : state;
		const questionText = readString(nestedPayload.clarification) ?? readString(nestedPayload.question) ?? readString(nestedPayload.message) ?? "";
		if (questionText) {
			const question = {
				id: `${state.intentId}:question:${event.seq}`,
				intentId: state.intentId,
				question: questionText,
				createdAt: event.createdAt,
				envelopeId: event.envelopeId,
				resolved: false,
				seq: event.seq
			};
			const withQuestion = {
				...nextState,
				questions: upsertQuestion(nextState.questions, question)
			};
			return appendTimeline(assistantText ? appendTimeline(withQuestion, {
				id: `${state.intentId}:${event.seq}:assistant`,
				seq: event.seq,
				type: `${event.type}.assistant`,
				title: "Assistant message",
				detail: assistantText,
				at: event.createdAt,
				kind: "human"
			}) : withQuestion, {
				id: `${state.intentId}:${event.seq}`,
				seq: event.seq,
				type: event.type,
				title: "Question for you",
				detail: questionText,
				at: event.createdAt,
				kind: "question"
			});
		}
		if (assistantText) return appendTimeline(nextState, {
			id: `${state.intentId}:${event.seq}:assistant`,
			seq: event.seq,
			type: `${event.type}.assistant`,
			title: "Assistant message",
			detail: assistantText,
			at: event.createdAt,
			kind: "human"
		});
	}
	return addDebugTimelineItem(state, event);
}
function applyRuntimeEnvelopeQueued(state, payload, event) {
	return appendTimeline(state, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: "Work queued",
		detail: summarizeEnvelopeLifecycle(payload),
		at: event.createdAt,
		actorId: readString(payload.actorId),
		fromActor: readString(payload.fromActor),
		toActor: readString(payload.toActor),
		envelopeId: event.envelopeId,
		kind: "intent"
	});
}
function applyRuntimeEnvelopeClaimed(state, payload, event) {
	return appendTimeline(state, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: "Work started",
		detail: summarizeEnvelopeLifecycle(payload),
		at: event.createdAt,
		actorId: readString(payload.actorId),
		fromActor: readString(payload.fromActor),
		toActor: readString(payload.toActor),
		envelopeId: event.envelopeId,
		kind: "intent"
	});
}
function applyRuntimeEnvelopeCompleted(state, payload, event) {
	return appendTimeline(state, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: "Work completed",
		detail: summarizeEnvelopeLifecycle(payload),
		at: event.createdAt,
		actorId: readString(payload.actorId),
		fromActor: readString(payload.fromActor),
		toActor: readString(payload.toActor),
		envelopeId: event.envelopeId,
		kind: "intent"
	});
}
function applyRuntimeEnvelopeFailed(state, payload, event) {
	return appendTimeline(readString(payload.actorId) === `intent/${state.intentId}` ? {
		...state,
		status: "failed",
		summary: readString(payload.error) ?? state.summary
	} : state, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: "Work failed",
		detail: summarizeEnvelopeLifecycle(payload),
		at: event.createdAt,
		actorId: readString(payload.actorId),
		fromActor: readString(payload.fromActor),
		toActor: readString(payload.toActor),
		envelopeId: event.envelopeId,
		kind: "intent"
	});
}
function applySkillCallStarted(state, payload, event) {
	const callId = readString(payload.callId) ?? `call-${event.seq}`;
	const nextCall = {
		callId,
		skillId: readString(payload.skillId) ?? "skill",
		request: readString(payload.request) ?? "",
		status: "pending",
		startedAt: event.createdAt,
		updatedAt: event.createdAt,
		metadata: payload
	};
	return appendTimeline({
		...state,
		skillCalls: {
			...state.skillCalls,
			[callId]: nextCall
		}
	}, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: `Skill call started · ${nextCall.skillId}`,
		detail: nextCall.request,
		at: event.createdAt,
		kind: "skill_call"
	});
}
function applySkillCallCompleted(state, payload, event) {
	const callId = readString(payload.callId) ?? inferLatestCallId(state.skillCalls);
	if (!callId) return addDebugTimelineItem(state, event);
	const current = state.skillCalls[callId];
	const messageType = readString(payload.messageType);
	const status = messageType === "skill.failed" ? "failed" : messageType === "skill.needs_clarification" ? "needs_clarification" : "completed";
	return appendTimeline({
		...state,
		skillCalls: {
			...state.skillCalls,
			[callId]: {
				callId,
				skillId: readString(payload.skillId) ?? current?.skillId ?? "skill",
				request: current?.request ?? readString(payload.request) ?? "",
				status,
				startedAt: current?.startedAt,
				updatedAt: event.createdAt,
				resultSummary: summarizePayload(payload),
				metadata: payload
			}
		}
	}, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: `Skill call ${status.replace("_", " ")}${current?.skillId ? ` · ${current.skillId}` : ""}`,
		detail: summarizePayload(payload),
		at: event.createdAt,
		kind: "skill_call"
	});
}
function applyWorker(state, payload, event, status) {
	const workerId = readString(payload.workerId) ?? readString(payload.workerActorId) ?? `worker-${event.seq}`;
	const existing = state.workers[workerId];
	return appendTimeline({
		...state,
		workers: {
			...state.workers,
			[workerId]: {
				workerId,
				skillId: readString(payload.skillId) ?? existing?.skillId,
				workerActorId: readString(payload.workerActorId) ?? existing?.workerActorId,
				status,
				startedAt: existing?.startedAt ?? event.createdAt,
				updatedAt: event.createdAt,
				metadata: payload
			}
		}
	}, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: `Worker ${status}`,
		detail: summarizePayload(payload),
		at: event.createdAt,
		kind: "worker"
	});
}
function addDebugTimelineItem(state, event) {
	return appendTimeline(state, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: event.type,
		detail: summarizePayload(toRecord(event.payload)),
		at: event.createdAt,
		kind: "debug"
	});
}
function appendTimeline(state, item) {
	if (state.timeline.some((existing) => existing.seq === item.seq && existing.type === item.type)) return state;
	return {
		...state,
		timeline: [...state.timeline, item].sort((a, b) => a.seq - b.seq)
	};
}
function upsertMessage(messages, next) {
	return [...messages.filter((message) => message.id !== next.id), next].sort(bySeqThenDate);
}
function upsertQuestion(questions, next) {
	return [...questions.filter((question) => question.id !== next.id), next].sort(bySeqThenDate);
}
function bySeqThenDate(a, b) {
	const seqDiff = (a.seq ?? 0) - (b.seq ?? 0);
	if (seqDiff !== 0) return seqDiff;
	return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
}
function toIntentOrchestrator(intent) {
	if (!intent) return null;
	const skills = buildSkills(intent);
	const subAgents = buildSubAgents(intent);
	return {
		id: intent.intentId,
		title: intent.title,
		summary: intent.summary,
		done: intent.status === "completed",
		isActivelyWorkedOn: isIntentActivelyWorkedOn(intent),
		lastActiveAt: intent.lastActiveAt,
		orchestratorLabel: "Jaensen Intent",
		subAgents,
		activity: buildActivity(intent, subAgents, skills),
		toolCalls: buildToolCalls(intent),
		hitlTodos: intent.questions.filter((question) => !question.resolved).map((question) => ({
			id: question.id,
			intentId: intent.intentId,
			title: "Reply to continue",
			status: "open",
			createdAt: question.createdAt ?? (/* @__PURE__ */ new Date()).toISOString(),
			type: "text_reply",
			question: question.question,
			placeholder: "Tell AvenCEO what to do next…"
		})),
		config: {
			routingMode: "select",
			workerClassLabel: "web-api dispatcher",
			notes: `Status: ${intent.status}`
		},
		skills
	};
}
function buildSkills(intent) {
	const ids = /* @__PURE__ */ new Set();
	for (const call of Object.values(intent.skillCalls)) ids.add(call.skillId);
	for (const worker of Object.values(intent.workers)) if (worker.skillId) ids.add(worker.skillId);
	return [...ids].sort().map((skillId) => ({
		skillId,
		name: skillId,
		bound: true
	}));
}
function buildSubAgents(intent) {
	return Object.values(intent.workers).sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? "")).map((worker) => ({
		id: worker.workerId,
		name: worker.workerActorId ?? worker.workerId,
		role: worker.skillId ? `${worker.skillId} worker` : "Worker",
		status: worker.status === "completed" ? "done" : intent.status === "waiting_for_user" ? "blocked_hitl" : "running",
		parentOrchestratorId: intent.intentId,
		blockedReason: intent.status === "waiting_for_user" ? "Waiting for your reply" : void 0,
		skillId: worker.skillId
	}));
}
function buildActivity(intent, subAgents, skills) {
	return intent.timeline.map((item) => ({
		id: item.id,
		at: formatTime(item.at),
		kind: mapTimelineKind(item.kind),
		title: item.title,
		detail: item.detail,
		agentId: resolveAgentId(item, subAgents, skills),
		actorIds: extractActorIds(item, intent.intentId, subAgents)
	}));
}
function extractActorIds(item, intentId, subAgents) {
	const values = [
		item.actorId,
		item.fromActor,
		item.toActor
	].filter((value) => typeof value === "string" && value.length > 0);
	if (item.kind === "question" || item.kind === "human") values.push(`intent/${intentId}`);
	const agentId = resolveAgentId(item, subAgents, []);
	if (agentId) values.push(agentId);
	return [...new Set(values)];
}
function buildToolCalls(intent) {
	return Object.values(intent.skillCalls).map((call) => ({
		id: `${intent.intentId}:${call.callId}`,
		agentId: findWorkerAgentId(intent, call.skillId) ?? call.callId,
		tool: call.skillId,
		inputSummary: call.request,
		outputSummary: call.resultSummary,
		status: call.status === "failed" ? "error" : call.status === "pending" ? "pending" : "ok"
	})).sort((a, b) => a.id.localeCompare(b.id));
}
function resolveAgentId(item, subAgents, skills) {
	if (item.kind !== "skill_call" && item.kind !== "worker") return void 0;
	const detail = item.detail ?? "";
	for (const subAgent of subAgents) if (detail.includes(subAgent.id) || detail.includes(subAgent.skillId ?? "")) return subAgent.id;
	for (const skill of skills) if (detail.includes(skill.skillId)) return subAgents.find((subAgent) => subAgent.skillId === skill.skillId)?.id;
}
function findWorkerAgentId(intent, skillId) {
	return Object.values(intent.workers).find((worker) => worker.skillId === skillId)?.workerId;
}
function mapTimelineKind(kind) {
	switch (kind) {
		case "human": return "human";
		case "question": return "hitl";
		case "intent": return "orchestrator";
		case "skill_call": return "tool";
		case "worker": return "sub_agent";
		default: return "delegation";
	}
}
function formatTime(value) {
	if (!value) return "--:--";
	return new Date(value).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit"
	});
}
function normalizeIntentStatus(status) {
	return status === "active" || status === "waiting_for_user" || status === "completed" || status === "failed" ? status : null;
}
function inferLatestCallId(skillCalls) {
	return Object.values(skillCalls).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0]?.callId ?? null;
}
function sortIntentIds(intents) {
	return intents.filter((intent) => Boolean(intent)).sort((a, b) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? "")).map((intent) => intent.intentId);
}
function summarizePayload(payload) {
	const result = readString(payload.request) ?? readString(payload.message) ?? readString(payload.question);
	if (result) return result;
	try {
		return JSON.stringify(payload);
	} catch {
		return;
	}
}
function summarizeEnvelopeLifecycle(payload) {
	const error = readString(payload.error);
	if (error) return error;
	const envelopeType = readString(payload.envelopeType);
	const workerId = readString(payload.workerId);
	const attempts = typeof payload.attempts === "number" ? payload.attempts : void 0;
	const parts = [
		envelopeType ? `Type: ${envelopeType}` : null,
		workerId ? `Worker: ${workerId}` : null,
		attempts !== void 0 ? `Attempt ${attempts}` : null
	].filter((value) => Boolean(value));
	return parts.length > 0 ? parts.join(" · ") : summarizePayload(payload);
}
function inferIntentIdFromPayload(payload) {
	const queue = [{
		value: payload,
		depth: 0
	}];
	const seen = /* @__PURE__ */ new WeakSet();
	let inspected = 0;
	const MAX_DEPTH = 6;
	const MAX_OBJECTS = 64;
	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) break;
		const { value, depth } = current;
		if (seen.has(value)) continue;
		seen.add(value);
		inspected += 1;
		if (inspected > MAX_OBJECTS) break;
		const direct = readString(value.intentId);
		if (direct) return direct;
		for (const key of [
			"actorId",
			"toActor",
			"fromActor"
		]) {
			const actorRef = readString(value[key]);
			if (actorRef?.startsWith("intent/")) return actorRef.slice(7);
		}
		if (depth >= MAX_DEPTH) continue;
		for (const key of [
			"event",
			"input",
			"result",
			"call",
			"payload"
		]) {
			const nested = value[key];
			if (nested && typeof nested === "object" && !Array.isArray(nested)) queue.push({
				value: nested,
				depth: depth + 1
			});
		}
	}
}
function inferCorrelationIdFromPayload(payload) {
	const queue = [{
		value: payload,
		depth: 0
	}];
	const seen = /* @__PURE__ */ new WeakSet();
	let inspected = 0;
	const MAX_DEPTH = 6;
	const MAX_OBJECTS = 64;
	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) break;
		const { value, depth } = current;
		if (seen.has(value)) continue;
		seen.add(value);
		inspected += 1;
		if (inspected > MAX_OBJECTS) break;
		const direct = readString(value.correlationId);
		if (direct) return direct;
		if (depth >= MAX_DEPTH) continue;
		for (const key of [
			"event",
			"input",
			"result",
			"call",
			"payload"
		]) {
			const nested = value[key];
			if (nested && typeof nested === "object" && !Array.isArray(nested)) queue.push({
				value: nested,
				depth: depth + 1
			});
		}
	}
}
function isIntentActivelyWorkedOn(intent, now = Date.now()) {
	if (intent.status !== "active") return false;
	if (!intent.correlationId || !intent.lastActiveAt) return false;
	const activeAt = Date.parse(intent.lastActiveAt);
	if (!Number.isFinite(activeAt)) return false;
	return now - activeAt < 6e4;
}
function toRecord(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function readString(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
//#endregion
//#region src/routes/(workspace)/me/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let contextTab = "overview";
		let selectedActorId = "intent/unset";
		let newTitle = "";
		let busy = false;
		const store = new IntentStore();
		const intents = derived(() => store.intentList());
		const selectedIntent = derived(() => store.selectedIntent());
		const error = derived(() => store.error);
		const selectedActorTier = derived(() => {
			return (selectedIntent() && actorSelectionRowForId(selectedIntent(), selectedActorId)?.tier) ?? "worker";
		});
		const contextTabs = derived(() => contextTabsForTier(selectedActorTier()));
		function captureUiError(context, err) {
			console.error(`[aven-ceo][/me] ${context}`, err);
			store.error = err instanceof Error ? err.stack ?? err.message : String(err);
		}
		function selectIntent(id) {
			store.selectIntent(id);
		}
		function handleRemove(id) {
			store.removeIntent(id);
		}
		function handleResolveHitl(todoId, payload) {
			const intent = selectedIntent();
			if (!intent) return;
			busy = true;
			store.error = null;
			(async () => {
				try {
					let message = "";
					if (payload.kind === "text_reply") message = payload.text.trim();
					else if (payload.kind === "choice") message = `Choice selected: ${payload.optionId}`;
					else message = payload.approved ? "Approved." : "Rejected.";
					if (!message) throw new Error("Response cannot be empty");
					await store.sendMessage(message, {
						intentIdHint: intent.id,
						resolvedQuestionId: todoId
					});
				} catch (err) {
					captureUiError("handleResolveHitl failed", err);
				} finally {
					busy = false;
				}
			})();
		}
		head("jjoznk", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>My workspace — Aven Maia</title>`);
			});
			$$renderer.push(`<link rel="preconnect" href="https://fonts.googleapis.com"/> <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous"/> <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&amp;display=swap" rel="stylesheet"/>`);
		});
		$$renderer.push(`<div class="flex flex-1 flex-col min-h-0 overflow-hidden">`);
		if (error()) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="px-6 pt-4 text-sm text-error">${escape_html(error())}</div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <main${attr_class(`${workspaceOrchestratorClass} flex-1 flex flex-col min-h-0 px-3 sm:px-5`)}><div class="grid grid-cols-1 min-h-0 flex-1 gap-3 sm:gap-4 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto_minmax(0,7.75rem)] xl:gap-3 xl:items-stretch pt-1 pb-1"><div class="min-w-0 min-h-0 flex flex-col xl:max-w-[15rem]">`);
		IntentLeftNav($$renderer, {
			intents: intents(),
			selectedId: store.selectedIntentId,
			onSelect: selectIntent,
			onRemove: handleRemove
		});
		$$renderer.push(`<!----></div> <div class="flex h-full min-h-0 min-w-0 flex-col">`);
		IntentCenterPanel($$renderer, {
			intent: selectedIntent(),
			panel: contextTab,
			selectedActorId,
			onResolveHitl: handleResolveHitl
		});
		$$renderer.push(`<!----></div> `);
		if (selectedIntent()) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="flex min-h-0 w-fit min-w-0 shrink-0 flex-col self-stretch justify-start">`);
			IntentRightRail($$renderer, {
				tabs: contextTabs(),
				tab: contextTab,
				onTab: (t) => contextTab = t
			});
			$$renderer.push(`<!----></div> <div class="min-h-0 max-w-31 shrink-0 xl:w-full"><div class="flex h-full min-h-0 flex-col gap-3"><div class="min-h-0 shrink-0">`);
			IntentActorColumn($$renderer, {
				intent: selectedIntent(),
				selectedActorId,
				onSelectActor: (id) => selectedActorId = id
			});
			$$renderer.push(`<!----></div> <div class="min-h-0 flex-1 border-l border-border/50 pl-2">`);
			SelectedActorDetails($$renderer, {
				intent: selectedIntent(),
				selectedActorId
			});
			$$renderer.push(`<!----></div></div></div>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<div class="hidden min-h-0 w-0 shrink-0 flex-col xl:flex" aria-hidden="true"></div> <div class="hidden min-h-0 max-w-31 shrink-0 xl:block xl:w-full" aria-hidden="true"></div>`);
		}
		$$renderer.push(`<!--]--></div></main> <div class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center bg-gradient-to-t from-background from-55% via-background/88 to-transparent px-3 pb-4 pt-3 sm:px-5 sm:pb-5"><div${attr_class(`pointer-events-auto w-full ${workspaceOrchestratorClass} px-3 sm:px-5`)}><section class="tech-pill !rounded-2xl max-w-full w-full items-start justify-between gap-2.5 py-2.5 px-3 sm:gap-3 sm:px-4"><div class="flex min-w-0 flex-1 items-start gap-2 sm:gap-2.5"><div class="size-8 shrink-0 self-start rounded-full border border-border flex items-center justify-center bg-white/20 mt-0.5 sm:size-9"><svg class="size-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"></path></svg></div> <form class="flex-1 min-w-0"><input type="file" class="hidden"/> <div${attr_class(`w-full min-w-0 `)}><textarea${attr("placeholder", "Send to Jaensen dispatcher…")}${attr("disabled", busy, true)} rows="1" class="w-full min-h-0 min-w-0 resize-none overflow-hidden bg-transparent border-none p-0 text-lg sm:text-xl font-medium tracking-tight placeholder:opacity-20 outline-none focus:ring-0 leading-snug">`);
		const $$body = escape_html(newTitle);
		if ($$body) $$renderer.push(`${$$body}`);
		$$renderer.push(`</textarea> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<div class="mt-1 flex items-center gap-2 text-[11px] opacity-50"><button type="button" class="underline">upload file</button> <span>or drag and drop here</span></div>`);
		$$renderer.push(`<!--]--></div></form></div> <div class="flex shrink-0 flex-col items-end border-l border-border pl-2 pt-1 sm:pl-2.5"><span class="text-[8px] font-bold uppercase opacity-30">Live</span> <span class="text-xs font-bold uppercase tracking-tighter">Jaensen</span></div></section></div></div></div>`);
	});
}
//#endregion
export { _page as default };
