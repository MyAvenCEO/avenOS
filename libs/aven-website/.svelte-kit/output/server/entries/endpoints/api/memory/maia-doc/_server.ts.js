import { a as ensureMaiaRulesFile, i as ensureMaiaAgentWorkspace, o as maiaRulesDataPath, r as soulMarkdownPath, t as ensureSoulMarkdownFile } from "../../../../../chunks/soul-md.js";
import { json } from "@sveltejs/kit";
import fs from "node:fs";
import path from "node:path";
//#region src/routes/api/memory/maia-doc/+server.ts
var KINDS = ["soul", "rules"];
function resolvePath(kind) {
	switch (kind) {
		case "soul": return soulMarkdownPath();
		case "rules": return maiaRulesDataPath();
	}
}
function parseKind(raw) {
	if (!raw) return null;
	const k = raw.trim().toLowerCase();
	return KINDS.includes(k) ? k : null;
}
var GET = async ({ url }) => {
	const kind = parseKind(url.searchParams.get("kind"));
	if (!kind) return json({
		ok: false,
		error: "Query ?kind=soul|rules required."
	}, { status: 400 });
	try {
		ensureMaiaAgentWorkspace();
		ensureSoulMarkdownFile();
		ensureMaiaRulesFile();
		const abs = resolvePath(kind);
		const content = fs.readFileSync(abs, "utf8");
		return json({
			ok: true,
			kind,
			path: `.data/agents/maia/${kind === "soul" ? "SOUL.md" : "RULES.md"}`,
			content
		});
	} catch (e) {
		return json({
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		}, { status: 500 });
	}
};
var PUT = async ({ request, url }) => {
	const kind = parseKind(url.searchParams.get("kind"));
	if (!kind) return json({
		ok: false,
		error: "Query ?kind=soul|rules required."
	}, { status: 400 });
	let body;
	try {
		body = await request.json();
	} catch {
		return json({
			ok: false,
			error: "Expected JSON body."
		}, { status: 400 });
	}
	if (body === null || typeof body !== "object" || typeof body.content !== "string") return json({
		ok: false,
		error: "Body must include { \"content\": string }."
	}, { status: 400 });
	const content = body.content;
	try {
		ensureMaiaAgentWorkspace();
		ensureSoulMarkdownFile();
		ensureMaiaRulesFile();
		const abs = resolvePath(kind);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content, "utf8");
		return json({
			ok: true,
			kind
		});
	} catch (e) {
		return json({
			ok: false,
			error: e instanceof Error ? e.message : String(e)
		}, { status: 500 });
	}
};
//#endregion
export { GET, PUT };
