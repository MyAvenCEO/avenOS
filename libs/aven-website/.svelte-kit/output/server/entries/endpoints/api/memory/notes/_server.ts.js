import { i as listVaultNotes, r as ensureVaultDir } from "../../../../../chunks/vault.js";
import { a as ensureMaiaRulesFile, t as ensureSoulMarkdownFile } from "../../../../../chunks/soul-md.js";
import { r as rebuildVaultGraph } from "../../../../../chunks/vault-graph.js";
import { t as buildVaultSnapshotPayload } from "../../../../../chunks/vault-snapshot-api.js";
import { json } from "@sveltejs/kit";
//#region src/lib/memory/memory-vault-maia-appendix.ts
/**
* Appended to the Memory UI vault index snapshot only (not the full Maia system blob).
* Links the dynamic knowledge table to the Maia runtime Markdown row in the sidebar.
*/
function memoryVaultSnapshotMaiaAppendix() {
	return [
		"",
		"---",
		"",
		"### Agents · Maia runtime (`.data/agents/maia`)",
		"",
		"These files shape **Talk** system context in order: **SOUL.md** → **vault owner** (`Humans/OWNER_*.md`, injected) → **RULES.md** → vault snapshot. Open **SOUL** / **RULES** from **agents / maia** in the sidebar; edit the owner note under **knowledge** → **Humans**.",
		"",
		"| File | Role |",
		"|------|------|",
		"| `SOUL.md` | Maia identity |",
		"| `RULES.md` | Tool + vault procedures |",
		"| `Humans/OWNER_*.md` | Vault owner identity + preferences (`##` sections) |"
	].join("\n");
}
//#endregion
//#region src/routes/api/memory/notes/+server.ts
var GET = async () => {
	try {
		ensureVaultDir();
		ensureSoulMarkdownFile();
		ensureMaiaRulesFile();
		const notes = await listVaultNotes();
		await rebuildVaultGraph();
		const snapshot = buildVaultSnapshotPayload(notes);
		const vaultMarkdown = snapshot.fullMarkdown + memoryVaultSnapshotMaiaAppendix();
		return json({
			ok: true,
			notes,
			vaultSnapshot: {
				generatedIso: snapshot.generatedIso,
				markdown: vaultMarkdown,
				tableMarkdownChars: snapshot.bodyMarkdown.length,
				noteCount: notes.length
			}
		});
	} catch (e) {
		return json({
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		}, { status: 500 });
	}
};
//#endregion
export { GET };
