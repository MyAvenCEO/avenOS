import { a as readVaultNote, i as listVaultNotes, o as resolveRepoRoot } from "./vault.js";
import { a as resolveWikilinkToVaultPath, o as bodyAfterFrontmatter, r as isTalkTurnWikilinkPath, t as forEachWikilinkPath } from "./wikilink-parse.js";
import fs from "node:fs";
import path from "node:path";
var GRAPH_FILE = "vault-graph.json";
function vaultStateDir() {
	return path.join(resolveRepoRoot(), ".data", "state");
}
function graphFileAbs() {
	return path.join(vaultStateDir(), GRAPH_FILE);
}
function ensureVaultStateDir() {
	const d = vaultStateDir();
	if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
function sortUnique(paths) {
	return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}
function dedupeIncoming(map) {
	const out = {};
	for (const [k, set] of map) out[k] = sortUnique([...set]);
	return out;
}
/**
* Full scan of `.data/knowledge` — builds resolved + unresolved wikilink edges.
*/
async function computeVaultGraph() {
	const notes = await listVaultNotes();
	const outgoing = /* @__PURE__ */ new Map();
	const unresolvedFrom = /* @__PURE__ */ new Map();
	let resolvedEdgeCount = 0;
	let unresolvedTargetCount = 0;
	for (const { path: src } of notes) {
		let raw;
		try {
			raw = await readVaultNote(src);
		} catch {
			continue;
		}
		const body = bodyAfterFrontmatter(raw);
		const paths = notes.map((n) => n.path);
		forEachWikilinkPath(body, (pathRaw) => {
			if (isTalkTurnWikilinkPath(pathRaw)) return;
			const res = resolveWikilinkToVaultPath(pathRaw, paths);
			if (res.status === "resolved") {
				const target = res.vaultPath;
				let set = outgoing.get(src);
				if (!set) {
					set = /* @__PURE__ */ new Set();
					outgoing.set(src, set);
				}
				if (!set.has(target)) {
					set.add(target);
					resolvedEdgeCount++;
				}
			} else {
				const label = res.status === "ambiguous" ? `${res.attempted} (${res.matches.length} matches)` : res.attempted;
				let uset = unresolvedFrom.get(src);
				if (!uset) {
					uset = /* @__PURE__ */ new Set();
					unresolvedFrom.set(src, uset);
				}
				if (!uset.has(label)) {
					uset.add(label);
					unresolvedTargetCount++;
				}
			}
		});
	}
	const backlinks = /* @__PURE__ */ new Map();
	for (const [src, targets] of outgoing) for (const t of targets) {
		let bs = backlinks.get(t);
		if (!bs) {
			bs = /* @__PURE__ */ new Set();
			backlinks.set(t, bs);
		}
		bs.add(src);
	}
	const outRecord = {};
	for (const [k, set] of outgoing) outRecord[k] = sortUnique([...set]);
	const unr = {};
	for (const [k, set] of unresolvedFrom) unr[k] = sortUnique([...set]);
	return {
		schemaVersion: 2,
		generatedIso: (/* @__PURE__ */ new Date()).toISOString(),
		outgoing: outRecord,
		backlinks: dedupeIncoming(backlinks),
		unresolvedFrom: unr,
		stats: {
			resolvedEdgeCount,
			unresolvedTargetCount
		}
	};
}
function writeVaultGraphState(state) {
	ensureVaultStateDir();
	fs.writeFileSync(graphFileAbs(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
async function rebuildVaultGraph() {
	const state = await computeVaultGraph();
	writeVaultGraphState(state);
	return state;
}
/** Reads cached graph or rebuilds if missing / unreadable. */
async function loadVaultGraph() {
	ensureVaultStateDir();
	const abs = graphFileAbs();
	if (!fs.existsSync(abs)) return rebuildVaultGraph();
	try {
		const raw = fs.readFileSync(abs, "utf8");
		const parsed = JSON.parse(raw);
		if (parsed?.schemaVersion !== 2 || typeof parsed.generatedIso !== "string" || typeof parsed.outgoing !== "object" || typeof parsed.backlinks !== "object" || typeof parsed.unresolvedFrom !== "object" || typeof parsed.stats !== "object") return rebuildVaultGraph();
		return parsed;
	} catch {
		return rebuildVaultGraph();
	}
}
/** Compact Markdown for Maia (bounded token use). */
function formatVaultGraphSummaryMarkdown(state) {
	const { resolvedEdgeCount, unresolvedTargetCount } = state.stats;
	const lines = [
		"### Vault link graph (derived from `[[wikilinks]]`)",
		"",
		`- **Resolved edges:** ${resolvedEdgeCount}`,
		`- **Unresolved wikilink targets:** ${unresolvedTargetCount}`
	];
	if (unresolvedTargetCount > 0) {
		const samples = [];
		for (const [src, targets] of Object.entries(state.unresolvedFrom)) {
			for (const t of targets) {
				samples.push(`\`${src}\` → missing \`${t}\``);
				if (samples.length >= 8) break;
			}
			if (samples.length >= 8) break;
		}
		if (samples.length) lines.push("", "Sample broken links (edit targets or create notes):", ...samples.map((s) => `- ${s}`));
	}
	return lines.join("\n");
}
//#endregion
export { loadVaultGraph as n, rebuildVaultGraph as r, formatVaultGraphSummaryMarkdown as t };
