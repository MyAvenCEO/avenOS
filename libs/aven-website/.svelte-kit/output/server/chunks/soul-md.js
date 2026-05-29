import { f as ensureSeedRuntimeSynced, o as resolveRepoRoot } from "./vault.js";
import { s as parseMarkdownFrontmatter } from "./wikilink-parse.js";
import fs from "node:fs";
import path from "node:path";
//#region src/lib/memory/maia-rules-md.ts
var MAIA_AGENT_DIR_SEG = [
	".data",
	"agents",
	"maia"
];
var RULES_SEED_REPO_PATH = path.join(resolveRepoRoot(), "seed", "agents", "maia", "RULES.md");
var LEGACY_RULES_PATH = path.join(resolveRepoRoot(), ".data", "context", "MaiaInstructions.md");
function maiaAgentDir() {
	return path.join(resolveRepoRoot(), ...MAIA_AGENT_DIR_SEG);
}
function ensureMaiaAgentWorkspace() {
	const dir = maiaAgentDir();
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function maiaRulesDataPath() {
	return path.join(maiaAgentDir(), "RULES.md");
}
function ensureMaiaRulesFile() {
	ensureMaiaAgentWorkspace();
	ensureSeedRuntimeSynced();
	const abs = maiaRulesDataPath();
	if (fs.existsSync(abs)) return;
	if (fs.existsSync(LEGACY_RULES_PATH)) {
		fs.copyFileSync(LEGACY_RULES_PATH, abs);
		return;
	}
	if (!fs.existsSync(RULES_SEED_REPO_PATH)) throw new Error(`Missing seed ${RULES_SEED_REPO_PATH} and no ${abs} — cannot bootstrap Maia RULES.md.`);
	fs.writeFileSync(abs, fs.readFileSync(RULES_SEED_REPO_PATH, "utf8"), "utf8");
}
function readMaiaRulesDoc() {
	ensureMaiaRulesFile();
	const doc = parseMarkdownFrontmatter(fs.readFileSync(maiaRulesDataPath(), "utf8"));
	return {
		meta: doc.meta,
		body: doc.body.trim()
	};
}
//#endregion
//#region src/lib/memory/soul-md.ts
var LEGACY_SOUL_PATH = path.join(resolveRepoRoot(), ".data", "SOUL.md");
var SOUL_SEED_PATH = path.join(resolveRepoRoot(), "seed", "agents", "maia", "SOUL.md");
/** `.data/agents/maia/SOUL.md` — agent identity (soul.py-style). */
function soulMarkdownPath() {
	return path.join(resolveRepoRoot(), ".data", "agents", "maia", "SOUL.md");
}
function readFallbackSoul() {
	if (fs.existsSync(SOUL_SEED_PATH)) try {
		return fs.readFileSync(SOUL_SEED_PATH, "utf8").trim();
	} catch {}
	return "# Maia identity\n\n(Seed SOUL file missing — restore `seed/agents/maia/SOUL.md`.)";
}
function ensureSoulMarkdownFile() {
	ensureMaiaAgentWorkspace();
	ensureSeedRuntimeSynced();
	const abs = soulMarkdownPath();
	if (fs.existsSync(abs)) return;
	if (fs.existsSync(LEGACY_SOUL_PATH)) {
		fs.copyFileSync(LEGACY_SOUL_PATH, abs);
		return;
	}
	if (!fs.existsSync(SOUL_SEED_PATH)) throw new Error(`Missing seed SOUL at ${SOUL_SEED_PATH}`);
	fs.writeFileSync(abs, fs.readFileSync(SOUL_SEED_PATH, "utf8"), "utf8");
}
/** Raw Markdown for the first system segment (before RULES + vault snapshot). */
function readSoulMarkdownBody() {
	ensureSoulMarkdownFile();
	try {
		return fs.readFileSync(soulMarkdownPath(), "utf8").trim();
	} catch {
		return readFallbackSoul();
	}
}
//#endregion
export { ensureMaiaRulesFile as a, ensureMaiaAgentWorkspace as i, readSoulMarkdownBody as n, maiaRulesDataPath as o, soulMarkdownPath as r, readMaiaRulesDoc as s, ensureSoulMarkdownFile as t };
