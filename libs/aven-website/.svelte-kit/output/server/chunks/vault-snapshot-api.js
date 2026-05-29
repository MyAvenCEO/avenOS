import { t as maiaAgent } from "./maia-agent.js";
//#region src/lib/memory/vault-index.ts
function formatVaultSnapshotMarkdown(rows) {
	if (!rows.length) return "_No notes yet. Use memory_write_file to create first files._";
	let md = "| Path | Title |\n|------|-------|\n";
	for (const r of rows) {
		const p = r.path.replace(/\|/g, "\\|");
		const t = r.title.replace(/\|/g, "\\|").replace(/\n/g, " ");
		md += `| ${p} | ${t} |\n`;
	}
	md += "\n**Use this snapshot for entity resolution**: if a human or org already maps to one Path above, prefer **memory_edit** on **that** path — do not add another file for synonyms (Sam vs Samuel).\n";
	return md;
}
//#endregion
//#region src/lib/memory/vault-snapshot-api.ts
/**
* Serialize the live vault index (same Markdown Maia receives under "Vault snapshot").
* Not stored on disk; derived by scanning all `.md` files under `.data/knowledge` recursively.
*/
function buildVaultSnapshotPayload(rows) {
	const generatedIso = (/* @__PURE__ */ new Date()).toISOString();
	const headlineMarkdown = maiaAgent.systemBundle.snapshotHeadingMarkdownTemplate.replace("{iso}", generatedIso);
	const bodyMarkdown = formatVaultSnapshotMarkdown(rows);
	return {
		generatedIso,
		headlineMarkdown,
		bodyMarkdown,
		fullMarkdown: `${headlineMarkdown}\n\n${bodyMarkdown}`
	};
}
//#endregion
export { buildVaultSnapshotPayload as t };
