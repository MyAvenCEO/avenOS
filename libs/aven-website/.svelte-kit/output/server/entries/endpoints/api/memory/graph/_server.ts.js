import { r as ensureVaultDir, t as assertVaultRelativePath } from "../../../../../chunks/vault.js";
import { n as loadVaultGraph } from "../../../../../chunks/vault-graph.js";
import { json } from "@sveltejs/kit";
//#region src/routes/api/memory/graph/+server.ts
var GET = async ({ url }) => {
	try {
		ensureVaultDir();
		const state = await loadVaultGraph();
		if (url.searchParams.get("full") === "1" || url.searchParams.get("export") === "1") return json({
			ok: true,
			state
		});
		const rawPath = url.searchParams.get("path");
		if (!rawPath?.trim()) return json({
			ok: true,
			generatedIso: state.generatedIso,
			stats: state.stats
		});
		const posix = assertVaultRelativePath(rawPath);
		return json({
			ok: true,
			path: posix,
			outgoing: state.outgoing[posix] ?? [],
			backlinks: state.backlinks[posix] ?? [],
			unresolved: state.unresolvedFrom[posix] ?? []
		});
	} catch (e) {
		return json({
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		}, { status: 400 });
	}
};
//#endregion
export { GET };
