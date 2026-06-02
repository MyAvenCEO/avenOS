import { ActorId } from "typed-actors";
import { ActorKind, type AvenRuntime } from "./spine.ts";

export async function spawnAvenRequest(runtime: AvenRuntime): Promise<void> {
  await runtime.actors.send({ id: ActorId.parse("/aven/system/llms"), kind: ActorKind.Llms }, {
    type: "submitLlmRequest",
    requirements: {
      input: { modalities: ["text"] },
      output: { modalities: ["text"] },
    },
    input: {
      messages: [
        {
          role: "user",
          content: [{ kind: "text", text: "spawned aven request" }],
        },
      ],
    },
  } as never);
}
