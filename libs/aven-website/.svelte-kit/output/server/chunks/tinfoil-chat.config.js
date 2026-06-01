import { c as vaultAbsolutePath, f as ensureSeedRuntimeSynced, i as listVaultNotes, o as resolveRepoRoot, p as maiaMemoryToolsJsonPath, r as ensureVaultDir, t as assertVaultRelativePath } from "./vault.js";
import { t as maiaAgent } from "./maia-agent.js";
import { n as readSoulMarkdownBody, s as readMaiaRulesDoc } from "./soul-md.js";
import { n as loadVaultGraph, t as formatVaultGraphSummaryMarkdown } from "./vault-graph.js";
import { t as buildVaultSnapshotPayload } from "./vault-snapshot-api.js";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
//#region src/lib/aven/maia-messages-path.ts
function maiaMessagesDir() {
	return path.join(resolveRepoRoot(), ".data", "agents", "maia", "messages");
}
function legacyMessagesDir() {
	return path.join(resolveRepoRoot(), ".data", "messages");
}
var migrationRan = false;
/**
* Best-effort copy from pre–agent-scope `.data/messages/` so existing chats survive
* the move to `.data/agents/maia/messages/` (`conversation.json`, `messageN.md` → `mN.md`).
* Idempotent per server process.
*/
function migrateLegacyMessagesToMaia() {
	if (migrationRan) return;
	migrationRan = true;
	const next = maiaMessagesDir();
	const old = legacyMessagesDir();
	if (!fs.existsSync(old)) return;
	if (!fs.existsSync(next)) fs.mkdirSync(next, { recursive: true });
	const cjOld = path.join(old, "conversation.json");
	const cjNew = path.join(next, "conversation.json");
	if (fs.existsSync(cjOld) && !fs.existsSync(cjNew)) fs.copyFileSync(cjOld, cjNew);
	for (const name of fs.readdirSync(old)) {
		const m = /^message(\d+)\.md$/i.exec(name);
		if (!m) continue;
		const dest = path.join(next, `m${m[1]}.md`);
		if (!fs.existsSync(dest)) fs.copyFileSync(path.join(old, name), dest);
	}
}
//#endregion
//#region src/lib/aven/conversation-store.ts
var CONV_FILE = "conversation.json";
function messagesDir() {
	migrateLegacyMessagesToMaia();
	return maiaMessagesDir();
}
var fileSchema = z.object({ messages: z.array(z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string()
})) });
function conversationPath() {
	return path.join(messagesDir(), CONV_FILE);
}
/** Same shape as `persistAvenMessageTurn` — parse User / Assistant sections. */
function parseTurnMarkdown(source) {
	const userBlock = /## User\s*\r?\n\r?\n([\s\S]*?)(?=\r?\n## Assistant\s|$)/i.exec(source) ?? /## User\s*\r?\n([\s\S]*?)(?=\r?\n## Assistant\s|$)/i.exec(source);
	const asstBlock = /## Assistant\s*\r?\n\r?\n([\s\S]*)$/i.exec(source);
	if (!userBlock?.[1] || !asstBlock?.[1]) return null;
	const user = userBlock[1].trim();
	const assistant = asstBlock[1].trim();
	if (!user && !assistant) return null;
	return {
		user,
		assistant
	};
}
/** Sorted indexes from filenames `m1.md`, `m2.md`, … */
function listMessageTurnIndexes(dir) {
	const out = [];
	if (!fs.existsSync(dir)) return out;
	for (const name of fs.readdirSync(dir)) {
		const m = /^m(\d+)\.md$/i.exec(name);
		if (m) out.push(Number.parseInt(m[1], 10));
	}
	out.sort((a, b) => a - b);
	return out;
}
/**
* Rebuild `{ role, content }[]` from per-turn markdown logs (`mN.md`).
* Used when **`conversation.json`** is missing / empty — e.g. JSON write failed earlier.
*/
function rebuildConversationFromMessageLogs() {
	const dir = messagesDir();
	const messages = [];
	for (const n of listMessageTurnIndexes(dir)) {
		const fp = path.join(dir, `m${n}.md`);
		let raw;
		try {
			raw = fs.readFileSync(fp, "utf8");
		} catch {
			continue;
		}
		const pair = parseTurnMarkdown(raw);
		if (!pair) continue;
		messages.push({
			role: "user",
			content: pair.user
		});
		messages.push({
			role: "assistant",
			content: pair.assistant
		});
	}
	return messages;
}
function readMessagesFromJsonFile() {
	const p = conversationPath();
	if (!fs.existsSync(p)) return [];
	try {
		const raw = JSON.parse(fs.readFileSync(p, "utf8"));
		const parsed = fileSchema.safeParse(raw);
		return parsed.success ? parsed.data.messages : [];
	} catch {
		return [];
	}
}
/** Reads rolling transcript JSON; falls back to `mN.md` logs and restores JSON. */
function readAvenConversation() {
	const fromJson = readMessagesFromJsonFile();
	if (fromJson.length > 0) return fromJson;
	const rebuilt = rebuildConversationFromMessageLogs();
	if (rebuilt.length > 0) try {
		writeAvenConversation(rebuilt);
	} catch {}
	return rebuilt;
}
function writeAvenConversation(messages) {
	const dir = messagesDir();
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(conversationPath(), JSON.stringify({ messages }, null, 2), "utf8");
}
//#endregion
//#region seed/memory/tools/memory.openai.json
var memory_openai_default = [
	{
		"type": "function",
		"function": {
			"name": "memory_list_notes",
			"description": "Structured list (JSON). Also redundant with vault snapshot yet useful after large edits — confirms latest tree.",
			"parameters": {
				"type": "object",
				"additionalProperties": false,
				"properties": {}
			}
		}
	},
	{
		"type": "function",
		"function": {
			"name": "memory_read_file",
			"description": "Read one vault Markdown file by vault-relative POSIX path.",
			"parameters": {
				"type": "object",
				"additionalProperties": false,
				"properties": { "path": { "type": "string" } },
				"required": ["path"]
			}
		}
	},
	{
		"type": "function",
		"function": {
			"name": "memory_edit",
			"description": "PRIMARY update tool — replace ONE unique substring in an existing note (oldString must occur exactly once). Prefer for paths already listed in the injected vault snapshot.",
			"parameters": {
				"type": "object",
				"additionalProperties": false,
				"properties": {
					"path": { "type": "string" },
					"oldString": {
						"type": "string",
						"description": "exact slice to replace — must occur exactly once; include ±2 lines for uniqueness."
					},
					"newString": { "type": "string" }
				},
				"required": [
					"path",
					"oldString",
					"newString"
				]
			}
		}
	},
	{
		"type": "function",
		"function": {
			"name": "memory_write_file",
			"description": "Create **ONLY** NEW notes whose Path token is missing from vault snapshot row list; otherwise misuse → duplicates.",
			"parameters": {
				"type": "object",
				"additionalProperties": false,
				"properties": {
					"path": { "type": "string" },
					"content": {
						"type": "string",
						"description": "Full Markdown contents"
					}
				},
				"required": ["path", "content"]
			}
		}
	},
	{
		"type": "function",
		"function": {
			"name": "memory_search",
			"description": "Cheap grep across filenames + bodies when snapshot titles insufficient for resolution.",
			"parameters": {
				"type": "object",
				"additionalProperties": false,
				"properties": {
					"query": { "type": "string" },
					"limit": {
						"type": "integer",
						"description": "default 20"
					}
				},
				"required": ["query"]
			}
		}
	}
];
//#endregion
//#region src/lib/memory/chat-tools-core.ts
/**
* OpenAI tool schemas: at runtime under `.data/agents/maia/tools/` (seeded from `seed/memory/tools/`).
* Procedural + identity Markdown lives under `.data/agents/maia/` (see `maia-rules-md.ts`, `soul-md.ts`).
*
* Server: reads JSON from disk after `ensureSeedRuntimeSynced()`.
* Browser: uses the committed `seed/` copy via `$seed` alias (for token/heuristic UI only).
*/
function memoryToolsOpenAI() {
	if (typeof window === "undefined") {
		ensureSeedRuntimeSynced();
		const p = maiaMemoryToolsJsonPath();
		if (!fs.existsSync(p)) throw new Error(`Missing tool definitions at ${p} — ensure seed/memory/tools/memory.openai.json exists.`);
		return JSON.parse(fs.readFileSync(p, "utf8"));
	}
	return memory_openai_default;
}
/** Short path tail for status copy (vault-relative, truncated). */
function memoryVaultPathTail(p, max = 44) {
	const s = String(p ?? "").replace(/\\/g, "/").trim();
	if (!s) return "…";
	return s.length > max ? `…${s.slice(-(max - 1))}` : s;
}
/** Short product title for status badge (tool id → human label). */
function memoryToolTitle(name) {
	switch (name) {
		case "memory_list_notes": return "List notes";
		case "memory_read_file": return "Read note";
		case "memory_edit": return "Edit note";
		case "memory_write_file": return "Write note";
		case "memory_search": return "Search vault";
		default: return name.replace(/^memory_/, "").replace(/_/g, " ") || name;
	}
}
/** User-facing line while a tool runs (shown in Maia status badge). */
function memoryToolRunningLine(name, args) {
	const title = memoryToolTitle(name);
	switch (name) {
		case "memory_list_notes": return `${title} · scanning vault…`;
		case "memory_read_file": return `${title} · ${memoryVaultPathTail(args.path)}`;
		case "memory_edit": return `${title} · ${memoryVaultPathTail(args.path)}`;
		case "memory_write_file": return `${title} · ${memoryVaultPathTail(args.path)}`;
		case "memory_search": {
			const q = String(args.query ?? "").trim();
			return `${title} · “${q.length > 40 ? `${q.slice(0, 38)}…` : q || "…"}”`;
		}
		default: return `${title} · running…`;
	}
}
/** Short confirmation after a tool returns (optional follow-up line). */
function memoryToolDoneLine(name) {
	const title = memoryToolTitle(name);
	switch (name) {
		case "memory_list_notes": return `${title} · done`;
		case "memory_read_file": return `${title} · done`;
		case "memory_edit": return `${title} · saved`;
		case "memory_write_file": return `${title} · saved`;
		case "memory_search": return `${title} · done`;
		default: return `${title} · done`;
	}
}
/** When the model queued several tools in one round. */
function memoryToolPlanLine(names) {
	return `Tools · ${[...new Set(names)].map((n) => memoryToolTitle(n)).join(" + ")}…`;
}
/** Summarize tool ids for “after …” thinking state. */
function memoryToolTitlesLine(names) {
	return [...new Set(names)].map((n) => memoryToolTitle(n)).join(" + ");
}
//#endregion
//#region src/lib/aven/context-preview.ts
/**
* Rough token estimate when no model tokenizer is available.
* English-ish prose averages ~4 chars/token; JSON/tool schemas skew higher — still useful for comparisons.
*/
function roughTokenEstimateChars(charCount) {
	if (charCount <= 0) return 0;
	return Math.max(1, Math.ceil(charCount / 4));
}
function memoryToolNamesOrdered() {
	return memoryToolsOpenAI().map((t) => t.type === "function" ? t.function.name : "").filter(Boolean);
}
function toolsSchemaJsonChars() {
	try {
		return JSON.stringify(memoryToolsOpenAI()).length;
	} catch {
		return 0;
	}
}
/**
* Structured description of what the server sends on the **first** chat.completions
* call (system text + user/assistant messages + tool definitions). Tool *results*
* are appended only in later internal rounds and are not listed here.
*/
function buildAvenContextPreview(opts) {
	const { model, messages, soulChars, ownerChars, instructionChars, vaultSnapshotChars, vaultGraphChars, fullSystemChars } = opts;
	const soulTokens = roughTokenEstimateChars(soulChars);
	const ownerTokens = roughTokenEstimateChars(ownerChars);
	const rulesTokens = roughTokenEstimateChars(instructionChars);
	const vaultSnapshotTokens = roughTokenEstimateChars(vaultSnapshotChars);
	const vaultGraphTokens = roughTokenEstimateChars(vaultGraphChars);
	let transcriptChars = 0;
	for (const m of messages) transcriptChars += m.content.length + 24;
	const transcriptTokens = roughTokenEstimateChars(transcriptChars);
	const toolsTokens = roughTokenEstimateChars(toolsSchemaJsonChars());
	const toolNames = memoryToolNamesOrdered();
	const heads = maiaAgent.contextPreview.sectionHeadings;
	return {
		model,
		sections: [
			{
				id: "soul",
				heading: heads.soul,
				estimatedTokens: soulTokens,
				bodyLines: []
			},
			{
				id: "owner",
				heading: heads.owner,
				estimatedTokens: ownerTokens,
				bodyLines: []
			},
			{
				id: "rules",
				heading: heads.rules,
				estimatedTokens: rulesTokens,
				bodyLines: []
			},
			{
				id: "vault_snapshot",
				heading: heads.vaultSnapshot,
				estimatedTokens: vaultSnapshotTokens,
				bodyLines: []
			},
			{
				id: "vault_graph",
				heading: heads.vaultGraph,
				estimatedTokens: vaultGraphTokens,
				bodyLines: []
			},
			{
				id: "tools",
				heading: heads.tools,
				estimatedTokens: toolsTokens,
				toolNames
			},
			{
				id: "transcript",
				heading: heads.transcript,
				estimatedTokens: transcriptTokens,
				items: messages.map((m, i) => ({
					key: `M${i + 1}`,
					role: m.role,
					snippet: m.content.length > 100 ? `${m.content.slice(0, 97).trim()}…` : m.content.trim() || "(empty)"
				}))
			}
		],
		totalEstimatedTokens: roughTokenEstimateChars(fullSystemChars) + transcriptTokens + toolsTokens
	};
}
//#endregion
//#region src/lib/memory/owner-context.ts
var OWNER_MD_RE = /^OWNER_.+\.md$/i;
/** Canonical vault folder for individual humans (identity + preference notes). */
var VAULT_HUMANS_DIR = "Humans";
/** How the vault owner note should be structured (injected once per turn; not a separate file). */
var OWNER_NOTE_GUIDE = `## Vault owner (under **Humans/**)

Everything about the **vault owner** — identity and preferences — lives in **one** Markdown file: **\`Humans/OWNER_<slug>.md\`**. Use **\`##\`** headings inside that file to separate concerns, for example:

- **\`## Identity\`** — name, roles, how they want to be addressed
- **\`## Preferences\`** — style, habits, timezone, likes, durable tastes

Do **not** maintain **\`Concepts/Preferences.md\`** for owner-scoped material; merge it into **\`Humans/OWNER_*.md\`** under the appropriate **\`##\`** sections with **\`memory_edit\`**.`;
function envOwnerBasename() {
	const v = typeof process !== "undefined" && process.env && typeof process.env.AVEN_VAULT_OWNER_HUMANS_FILE === "string" ? process.env.AVEN_VAULT_OWNER_HUMANS_FILE.trim() : "";
	if (!v) return null;
	if (!v.endsWith(".md") || v.includes("..") || v.includes("/")) return null;
	if (!OWNER_MD_RE.test(v)) return null;
	return v;
}
function listOwnerBasenames(relDir) {
	const dir = path.join(vaultAbsolutePath(), relDir);
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir).filter((f) => OWNER_MD_RE.test(f) && fs.statSync(path.join(dir, f)).isFile());
}
/** First matching \`OWNER_*.md\` under \`Humans/\` (sorted). */
function discoverOwnerBasenameFromVault() {
	const names = listOwnerBasenames(VAULT_HUMANS_DIR);
	names.sort((a, b) => a.localeCompare(b));
	const n0 = names[0];
	return n0 !== void 0 ? n0 : null;
}
function resolveOwnerVaultRelPath() {
	const fromEnv = envOwnerBasename();
	if (fromEnv) return {
		path: `${VAULT_HUMANS_DIR}/${fromEnv}`,
		basename: fromEnv
	};
	const b = discoverOwnerBasenameFromVault();
	if (!b) return null;
	return {
		path: `${VAULT_HUMANS_DIR}/${b}`,
		basename: b
	};
}
function tryReadVaultRel(posixRel) {
	try {
		assertVaultRelativePath(posixRel);
		const full = path.join(vaultAbsolutePath(), ...posixRel.split("/"));
		return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
	} catch {
		return null;
	}
}
/**
* Injected into the system prompt **after** SOUL and **before** RULES.
* Static conventions plus the live **`Humans/OWNER_*.md`** body (identity + preferences as ## sections).
*/
function buildOwnerContextMarkdown() {
	ensureVaultDir();
	const ownerPath = resolveOwnerVaultRelPath()?.path ?? null;
	const owner = ownerPath ? tryReadVaultRel(ownerPath) : null;
	const sortedOwners = [...listOwnerBasenames(VAULT_HUMANS_DIR)].sort((a, b) => a.localeCompare(b));
	const multiOwner = sortedOwners.length > 1 ? `\n_(Several \`Humans/OWNER_*.md\` files exist (${sortedOwners.join(", ")}); active file follows env override, else first sort order — keep a single owner note.)_` : "";
	let liveBlock;
	if (ownerPath) if (owner?.trim()) liveBlock = [`### \`${ownerPath}\` (live)${multiOwner}`, owner.trim()];
	else liveBlock = [`### \`${ownerPath}\` (live)${multiOwner}`, `_(missing or empty — add **\`## Identity\`** and **\`## Preferences\`** sections as needed.)_`];
	else liveBlock = ["### `Humans/OWNER_<slug>.md` (not created yet)", `_(No \`Humans/OWNER_*.md\` and no valid **\`AVEN_VAULT_OWNER_HUMANS_FILE\`**. Learn the human’s name from **conversation**, then create **one** note under **\`Humans/\`** with **\`## Identity\`** (and **\`## Preferences\`** when relevant). Choose **\`<slug>\`** from how they introduce themselves.)_${multiOwner}`];
	return [
		OWNER_NOTE_GUIDE,
		"",
		...liveBlock
	].join("\n");
}
//#endregion
//#region src/lib/aven/live-context.ts
/**
* Builds the same system bundle + context preview the chat stream uses for `messages`.
* Order: **SOUL** → **vault owner** (`Humans/OWNER_*.md`) → **RULES** → **vault snapshot** → **vault link graph summary** (derived `[[wikilinks]]` stats).
*/
async function buildAvenChatRoundContext(model, messages) {
	ensureVaultDir();
	const proceduralBody = readMaiaRulesDoc().body;
	const notes = await listVaultNotes();
	const soulRaw = readSoulMarkdownBody().trimEnd();
	const ownerMd = buildOwnerContextMarkdown();
	const snap = buildVaultSnapshotPayload(notes);
	const graphMd = formatVaultGraphSummaryMarkdown(await loadVaultGraph());
	const d = maiaAgent.systemBundle.delimiterMarkdown.trim();
	const systemContent = `${soulRaw}\n\n${d}\n\n${ownerMd}\n\n${d}\n\n${proceduralBody}\n\n${d}\n\n${snap.fullMarkdown}\n\n${d}\n\n${graphMd}`;
	let toolsSchemaJson;
	try {
		toolsSchemaJson = JSON.stringify(memoryToolsOpenAI(), null, 2);
	} catch {
		toolsSchemaJson = "[]";
	}
	const fullContext = {
		soulMarkdown: soulRaw,
		ownerMarkdown: ownerMd,
		rulesMarkdown: proceduralBody,
		vaultSnapshotMarkdown: snap.fullMarkdown,
		vaultGraphMarkdown: graphMd,
		toolsSchemaJson,
		messages
	};
	return {
		systemContent,
		preview: buildAvenContextPreview({
			model,
			messages,
			soulChars: soulRaw.length,
			ownerChars: ownerMd.length,
			instructionChars: proceduralBody.length,
			vaultSnapshotChars: snap.fullMarkdown.length,
			vaultGraphChars: graphMd.length,
			fullSystemChars: systemContent.length
		}),
		fullContext
	};
}
var tinfoil_chat_config_default = { chatModel: "glm-5-1" };
//#endregion
export { memoryToolRunningLine as a, readAvenConversation as c, migrateLegacyMessagesToMaia as d, memoryToolPlanLine as i, writeAvenConversation as l, buildAvenChatRoundContext as n, memoryToolTitlesLine as o, memoryToolDoneLine as r, memoryToolsOpenAI as s, tinfoil_chat_config_default as t, maiaMessagesDir as u };
