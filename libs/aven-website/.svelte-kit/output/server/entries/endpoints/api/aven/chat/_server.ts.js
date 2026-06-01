import { n as private_env } from "../../../../../chunks/shared-server.js";
import { a as readVaultNote, i as listVaultNotes, l as writeVaultNote, n as editVaultNote, r as ensureVaultDir, s as searchVault } from "../../../../../chunks/vault.js";
import { a as memoryToolRunningLine, d as migrateLegacyMessagesToMaia, i as memoryToolPlanLine, l as writeAvenConversation, n as buildAvenChatRoundContext, o as memoryToolTitlesLine, r as memoryToolDoneLine, s as memoryToolsOpenAI, t as tinfoil_chat_config_default, u as maiaMessagesDir } from "../../../../../chunks/tinfoil-chat.config.js";
import { t as maiaAgent } from "../../../../../chunks/maia-agent.js";
import { r as rebuildVaultGraph } from "../../../../../chunks/vault-graph.js";
import { json } from "@sveltejs/kit";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { TinfoilAI } from "tinfoil";
import { AsyncLocalStorage } from "node:async_hooks";
//#region src/lib/aven/chat-message-log.ts
/** Local-only Maia transcript directory; lives under `.data/agents/maia/messages`. */
function messagesLogDir() {
	migrateLegacyMessagesToMaia();
	return maiaMessagesDir();
}
function ensureMessagesDir() {
	const root = messagesLogDir();
	if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
	const readme = path.join(root, "README.md");
	if (!fs.existsSync(readme)) fs.writeFileSync(readme, "# README.md\n\nAgent-bound transcript under **`.data/agents/maia/messages/`**.\n\n- **`conversation.json`** — rolling chat (user / assistant turns) restored on `/talk`; if it is missing or empty, the server rebuilds from **`mN.md`** and rewrites JSON.\n- **`m1.md`, `m2.md`, …** — one Markdown file per completed assistant reply.\n\nLocal only; not committed.\n", "utf8");
	return root;
}
function nextMessageIndex(dir) {
	if (!fs.existsSync(dir)) return 1;
	let max = 0;
	for (const name of fs.readdirSync(dir)) {
		const m = /^m(\d+)\.md$/i.exec(name);
		if (m) max = Math.max(max, Number.parseInt(m[1], 10));
	}
	return max + 1;
}
/**
* Index **`mN.md`** that the **next** `persistAvenMessageTurn` will write (same logic as at persist time).
* Used to attribute vault tool edits to the in-flight assistant turn before the file exists.
*/
function peekNextAssistantMessageIndex() {
	return nextMessageIndex(ensureMessagesDir());
}
/**
* Appends one markdown file per completed exchange: `m1.md`, `m2.md`, …
*/
function persistAvenMessageTurn(opts) {
	const lastUser = [...opts.messages].reverse().find((m) => m.role === "user");
	if (!lastUser?.content.trim()) return;
	const root = ensureMessagesDir();
	const n = nextMessageIndex(root);
	const iso = (/* @__PURE__ */ new Date()).toISOString();
	const body = `# m${n}.md\n\n_${opts.model}_ · _${iso}_\n\n## User\n\n${lastUser.content.trim()}\n\n## Assistant\n\n${opts.assistantReply.trim()}\n`;
	fs.writeFileSync(path.join(root, `m${n}.md`), body, "utf8");
}
//#endregion
//#region src/lib/aven/chat-request.ts
var avenChatMessageSchema = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string()
});
var avenChatBodySchema = z.object({
	messages: z.array(avenChatMessageSchema).min(1),
	model: z.string().optional(),
	/** When true, response is application/x-ndjson with status + done events */
	stream: z.boolean().optional()
});
//#endregion
//#region src/lib/aven/memory-tool-context.ts
var memoryToolSourceAls = new AsyncLocalStorage();
//#endregion
//#region src/lib/memory/chat-tools.ts
/** Server-side tool execution against Jazz-backed memory with fs projection export. */
async function executeMemoryTool(name, args) {
	ensureVaultDir();
	try {
		switch (name) {
			case "memory_list_notes": return JSON.stringify({ notes: await listVaultNotes() });
			case "memory_read_file": return await readVaultNote(String(args.path ?? ""));
			case "memory_edit": {
				const rel = String(args.path ?? "");
				const src = memoryToolSourceAls.getStore() ?? { type: "memory_ui" };
				await editVaultNote(rel, String(args.oldString ?? ""), String(args.newString ?? ""), src);
				await rebuildVaultGraph();
				return JSON.stringify({
					ok: true,
					path: rel
				});
			}
			case "memory_write_file": {
				const p = String(args.path ?? "");
				const content = String(args.content ?? "");
				await writeVaultNote(p, content, memoryToolSourceAls.getStore() ?? { type: "memory_ui" });
				await rebuildVaultGraph();
				return JSON.stringify({
					ok: true,
					path: p,
					bytes: content.length
				});
			}
			case "memory_search": {
				const q = String(args.query ?? "");
				const lim = typeof args.limit === "number" ? args.limit : 20;
				return JSON.stringify({ hits: await searchVault(q, lim) });
			}
			default: return JSON.stringify({ error: `Unknown tool: ${name}` });
		}
	} catch (e) {
		return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
	}
}
//#endregion
//#region src/lib/aven/run-aven-chat.ts
var MAX_TOOL_ROUNDS = maiaAgent.llm.maxToolRounds;
async function* streamAvenChatCore(messages, apiKey, model) {
	yield {
		type: "status",
		detail: "Maia · connecting…"
	};
	const client = new TinfoilAI({ apiKey });
	await client.ready();
	/** Same index as the `mN.md` file this turn will write on `done` (provenance for memory tools). */
	const reservedAssistantTurn = peekNextAssistantMessageIndex();
	const { systemContent, preview, fullContext } = await buildAvenChatRoundContext(model, messages);
	const tools = memoryToolsOpenAI();
	const thread = [{
		role: "system",
		content: systemContent
	}, ...messages.map((m) => ({
		role: m.role,
		content: m.content
	}))];
	yield {
		type: "context",
		preview,
		fullContext
	};
	yield {
		type: "status",
		detail: "Maia · ready"
	};
	let prevRoundToolNames = [];
	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		yield {
			type: "status",
			detail: round === 0 ? "Maia · thinking…" : prevRoundToolNames.length > 0 ? `Maia · next · after ${memoryToolTitlesLine(prevRoundToolNames)}` : "Maia · thinking…"
		};
		let completion;
		try {
			completion = await client.chat.completions.create({
				model,
				temperature: maiaAgent.llm.temperature,
				messages: thread,
				tools,
				tool_choice: maiaAgent.llm.toolChoice === "none" ? "none" : "auto"
			});
		} catch (e) {
			yield {
				type: "error",
				message: e instanceof Error ? e.message : String(e),
				status: 502
			};
			return;
		}
		const choice = completion.choices[0]?.message;
		if (!choice) {
			yield {
				type: "error",
				message: "No assistant message.",
				status: 422
			};
			return;
		}
		const toolCalls = choice.tool_calls;
		if (toolCalls?.length) {
			thread.push({
				role: "assistant",
				content: choice.content ?? null,
				tool_calls: toolCalls
			});
			const names = toolCalls.filter((tc) => tc.type === "function").map((tc) => tc.function.name);
			yield {
				type: "status",
				detail: names.length > 0 ? `Maia · ${memoryToolPlanLine(names)}` : "Maia · choosing tools…"
			};
			for (const tc of toolCalls) {
				if (tc.type !== "function") continue;
				const fn = tc.function;
				let parsed = {};
				try {
					parsed = JSON.parse(fn.arguments || "{}");
				} catch {
					parsed = {};
				}
				yield {
					type: "status",
					detail: `Maia · ${memoryToolRunningLine(fn.name, parsed)}`
				};
				const payload = await memoryToolSourceAls.run({
					type: "talk",
					messageTurn: reservedAssistantTurn
				}, () => executeMemoryTool(fn.name, parsed));
				thread.push({
					role: "tool",
					tool_call_id: tc.id,
					content: payload
				});
				yield {
					type: "status",
					detail: `Maia · ${memoryToolDoneLine(fn.name)}`
				};
			}
			prevRoundToolNames = names;
			yield {
				type: "status",
				detail: "Maia · next · reasoning…"
			};
			continue;
		}
		const text = choice.content?.trim();
		if (!text) {
			yield {
				type: "error",
				message: "Assistant returned empty content.",
				status: 422
			};
			return;
		}
		yield {
			type: "done",
			reply: text,
			model
		};
		return;
	}
	yield {
		type: "error",
		message: "Stopped after maximum tool rounds (possible tool loop).",
		status: 422
	};
}
async function* streamAvenChat(messages, apiKey, model) {
	try {
		yield* streamAvenChatCore(messages, apiKey, model);
	} catch (e) {
		yield {
			type: "error",
			message: e instanceof Error ? e.message : String(e),
			status: 500
		};
	}
}
async function runAvenChat(messages, apiKey, model) {
	for await (const ev of streamAvenChat(messages, apiKey, model)) {
		if (ev.type === "done") return {
			ok: true,
			reply: ev.reply
		};
		if (ev.type === "error") return {
			ok: false,
			message: ev.message,
			status: ev.status
		};
	}
	return {
		ok: false,
		message: "Stream ended unexpectedly.",
		status: 500
	};
}
//#endregion
//#region src/routes/api/aven/chat/+server.ts
var POST = async ({ request }) => {
	let raw;
	try {
		raw = await request.json();
	} catch {
		return json({
			ok: false,
			error: "Expected JSON body."
		}, { status: 400 });
	}
	const parsed = avenChatBodySchema.safeParse(raw);
	if (!parsed.success) return json({
		ok: false,
		error: parsed.error.message
	}, { status: 400 });
	const apiKey = private_env.TINFOIL_API_KEY?.trim();
	if (!apiKey) return json({
		ok: false,
		error: "TINFOIL_API_KEY is not configured on the server."
	}, { status: 503 });
	const fromMaia = typeof maiaAgent.llm.defaultModel === "string" && maiaAgent.llm.defaultModel.trim().length > 0 ? maiaAgent.llm.defaultModel.trim() : "";
	const fromTinfoilLegacy = typeof tinfoil_chat_config_default.chatModel === "string" && tinfoil_chat_config_default.chatModel.trim().length > 0 ? tinfoil_chat_config_default.chatModel.trim() : "";
	const fallbackChatModel = fromMaia || fromTinfoilLegacy || "glm-5-1";
	const model = (parsed.data.model ?? fallbackChatModel).trim();
	if (parsed.data.stream === true) {
		const encoder = new TextEncoder();
		const stream = new ReadableStream({ async start(controller) {
			function send(ev) {
				controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
			}
			try {
				for await (const ev of streamAvenChat(parsed.data.messages, apiKey, model)) {
					if (ev.type === "done") {
						const full = [...parsed.data.messages, {
							role: "assistant",
							content: ev.reply
						}];
						try {
							persistAvenMessageTurn({
								messages: parsed.data.messages,
								assistantReply: ev.reply,
								model: ev.model
							});
							writeAvenConversation(full);
						} catch (err) {
							console.error("[aven/chat] persist conversation / message log failed", err);
						}
					}
					send(ev);
				}
			} catch (e) {
				send({
					type: "error",
					message: e instanceof Error ? e.message : String(e),
					status: 500
				});
			} finally {
				controller.close();
			}
		} });
		return new Response(stream, { headers: {
			"Content-Type": "application/x-ndjson; charset=utf-8",
			"Cache-Control": "no-store"
		} });
	}
	const result = await runAvenChat(parsed.data.messages, apiKey, model);
	if (!result.ok) return json({
		ok: false,
		error: result.message
	}, { status: result.status });
	const full = [...parsed.data.messages, {
		role: "assistant",
		content: result.reply
	}];
	try {
		persistAvenMessageTurn({
			messages: parsed.data.messages,
			assistantReply: result.reply,
			model
		});
		writeAvenConversation(full);
	} catch (err) {
		console.error("[aven/chat] persist conversation / message log failed", err);
	}
	return json({
		ok: true,
		reply: result.reply,
		model
	});
};
//#endregion
export { POST };
