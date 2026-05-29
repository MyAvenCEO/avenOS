import { c as readAvenConversation, n as buildAvenChatRoundContext, t as tinfoil_chat_config_default } from "../../../../../chunks/tinfoil-chat.config.js";
import { t as maiaAgent } from "../../../../../chunks/maia-agent.js";
import { json } from "@sveltejs/kit";
//#region src/routes/api/aven/conversation/+server.ts
function defaultChatModel() {
	const m = typeof maiaAgent.llm.defaultModel === "string" ? maiaAgent.llm.defaultModel.trim() : "";
	if (m.length > 0) return m;
	const v = tinfoil_chat_config_default.chatModel;
	return typeof v === "string" && v.trim().length > 0 ? v.trim() : "glm-5-1";
}
var GET = async () => {
	const messages = readAvenConversation();
	const { preview, fullContext } = await buildAvenChatRoundContext(defaultChatModel(), messages);
	return json({
		ok: true,
		messages,
		contextPreview: preview,
		fullContext
	});
};
//#endregion
export { GET };
