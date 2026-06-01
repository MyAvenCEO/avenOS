import { a as readVaultNote, l as writeVaultNote, r as ensureVaultDir } from "../../../../../chunks/vault.js";
import { r as rebuildVaultGraph } from "../../../../../chunks/vault-graph.js";
import { json } from "@sveltejs/kit";
//#region src/routes/api/memory/note/+server.ts
var GET = async ({ url }) => {
	const pathParam = url.searchParams.get("path");
	if (!pathParam?.trim()) return json({
		ok: false,
		error: "Missing path query."
	}, { status: 400 });
	try {
		ensureVaultDir();
		return json({
			ok: true,
			path: pathParam,
			content: await readVaultNote(pathParam)
		});
	} catch (e) {
		return json({
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		}, { status: 404 });
	}
};
var PUT = async ({ request }) => {
	let raw;
	try {
		raw = await request.json();
	} catch {
		return json({
			ok: false,
			error: "Expected JSON body."
		}, { status: 400 });
	}
	if (typeof raw !== "object" || raw === null || typeof raw.path !== "string" || typeof raw.content !== "string") return json({
		ok: false,
		error: "Body must include path and content strings."
	}, { status: 400 });
	const { path: relPath, content } = raw;
	try {
		ensureVaultDir();
		await writeVaultNote(relPath, content, { type: "memory_ui" });
		await rebuildVaultGraph();
		return json({
			ok: true,
			path: relPath
		});
	} catch (e) {
		return json({
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		}, { status: 400 });
	}
};
//#endregion
export { GET, PUT };
