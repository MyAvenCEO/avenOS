import { n as private_env } from "../../../../../chunks/shared-server.js";
import { json } from "@sveltejs/kit";
import { z } from "zod";
import { TinfoilAI } from "tinfoil";
//#endregion
//#region src/lib/aven/intent-request.ts
var classifyIntentArgsSchema = z.object({
	worker_mode: z.enum(["select", "spawn"]),
	worker_class: z.enum([
		"calendar",
		"finance",
		"health",
		"projects"
	]),
	request_title: z.string(),
	instructions: z.string(),
	spawn_worker_key: z.string().optional(),
	spawn_worker_display_name: z.string().optional()
});
var inferenceSnapshotSchema = z.object({
	model: z.string(),
	temperature: z.number().optional(),
	systemPrompt: z.string(),
	userIntentTemplate: z.string(),
	forcedToolName: z.string(),
	toolsJson: z.string(),
	responsesMissingApiKey: z.string().optional(),
	responsesNoToolCalls: z.string().optional(),
	responsesInvalidBody: z.string().optional()
});
var postIntentBodySchema = z.object({
	intent: z.string().min(1),
	snapshot: inferenceSnapshotSchema
});
//#endregion
//#region src/lib/aven/run-intent.ts
async function runIntentClassification(intent, snapshot, apiKey) {
	let toolsUnknown;
	try {
		toolsUnknown = JSON.parse(snapshot.toolsJson);
	} catch {
		return {
			ok: false,
			message: "Invalid toolsJson in snapshot.",
			status: 500
		};
	}
	const client = new TinfoilAI({ apiKey });
	await client.ready();
	const userContent = snapshot.userIntentTemplate.includes("{{intent}}") ? snapshot.userIntentTemplate.replaceAll("{{intent}}", intent) : `${snapshot.userIntentTemplate}\n\n${intent}`;
	let completion;
	try {
		completion = await client.chat.completions.create({
			model: snapshot.model,
			temperature: snapshot.temperature ?? .1,
			messages: [{
				role: "system",
				content: snapshot.systemPrompt
			}, {
				role: "user",
				content: userContent
			}],
			tools: toolsUnknown,
			tool_choice: {
				type: "function",
				function: { name: snapshot.forcedToolName }
			}
		});
	} catch (e) {
		return {
			ok: false,
			message: e instanceof Error ? e.message : String(e),
			status: 502
		};
	}
	const tc = (completion.choices[0]?.message)?.tool_calls?.[0];
	if (!tc || tc.type !== "function") return {
		ok: false,
		message: snapshot.responsesNoToolCalls ?? "No tool call.",
		status: 422
	};
	if (tc.function.name !== snapshot.forcedToolName) return {
		ok: false,
		message: snapshot.responsesNoToolCalls ?? "Unexpected tool name.",
		status: 422
	};
	const raw = tc.function.arguments;
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			ok: false,
			message: snapshot.responsesInvalidBody ?? "Tool arguments were not valid JSON.",
			status: 422
		};
	}
	const args = classifyIntentArgsSchema.safeParse(parsed);
	if (!args.success) return {
		ok: false,
		message: snapshot.responsesInvalidBody ?? args.error.issues.map((i) => i.message).join("; "),
		status: 422
	};
	return {
		ok: true,
		args: args.data,
		rawToolArguments: raw
	};
}
//#endregion
//#region src/routes/api/aven/intent/+server.ts
/** Live intent classification; `/me` workspace uses a client-only mock and does not call this route. */
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
	const parsed = postIntentBodySchema.safeParse(raw);
	if (!parsed.success) return json({
		ok: false,
		error: (typeof raw === "object" && raw !== null && "snapshot" in raw && typeof raw.snapshot === "object" ? raw.snapshot : void 0)?.responsesInvalidBody ?? parsed.error.message
	}, { status: 400 });
	const { intent, snapshot } = parsed.data;
	const apiKey = private_env.TINFOIL_API_KEY?.trim();
	if (!apiKey) return json({
		ok: false,
		error: snapshot.responsesMissingApiKey ?? "TINFOIL_API_KEY is not configured."
	}, { status: 503 });
	const result = await runIntentClassification(intent, snapshot, apiKey);
	if (!result.ok) return json({
		ok: false,
		error: result.message
	}, { status: result.status });
	return json({
		ok: true,
		classification: result.args,
		rawToolArguments: result.rawToolArguments
	});
};
//#endregion
export { POST };
