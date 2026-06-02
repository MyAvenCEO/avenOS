import {
  type ActorDefinitionMap,
} from "typed-actors";
import {
  type ActorTreePresentationMap,
} from "typed-actors-introspection";
import type {
  AvailableLlmDescriptor,
  ClassifiedError,
  ConfiguredLlmModel,
  ConfiguredLlmProvider,
  DescribeCapabilitiesMessage,
  FindLlmsByCapabilitiesMessage,
  GetResultMessage,
  GetLlmUsageMessage,
  ListAvailableLlmsMessage,
  ListModelsMessage,
  ListRequestsMessage,
  LlmCapabilityRequirements,
  LlmMessage,
  LlmModelCapabilities,
  LlmProviderAuth,
  LlmProvidersConfig,
  LlmRequest,
  LlmRequestCompleted,
  LlmResult,
  LlmUsageMeter,
  LlmValidationCompleted,
  LlmInputPart,
  LlmOutputPart,
  ValidateLlmInputMessage,
} from "llm-contracts";
import type { AvenRegistry } from "../../runtime/src/spine.ts";
import type { BuildLlmSubsystemOptions, CompletedLlmRequest, LlmPendingGatewayRequest, LlmRequestRetentionPolicy, LlmRequestWorkerAwaiting, LlmRequestWorkerMessage, LlmRequestWorkerState, LlmsMessage, LlmsState, LlmModelMessage, LlmModelState, LlmProviderMessage, LlmProviderState, QueuedRequest, RegisterAvailableLlmMessage, RunningRequest } from "./actors/llms/types.ts";
import { buildPreparedLlmSubsystemBundle } from "./prepared-subsystem.ts";
import { llmDebugMessageDescriptors } from "./actors/llms/shape.ts";

export type {
  ClassifiedError,
  AvailableLlmDescriptor,
  ConfiguredLlmModel,
  ConfiguredLlmProvider,
  DescribeCapabilitiesMessage,
  FindLlmsByCapabilitiesMessage,
  GetResultMessage,
  GetLlmUsageMessage,
  ListAvailableLlmsMessage,
  ListModelsMessage,
  ListRequestsMessage,
  LlmCapabilityRequirements,
  LlmMessage,
  LlmModelCapabilities,
  LlmProviderAuth,
  LlmProvidersConfig,
  LlmRequest,
  LlmRequestCompleted,
  LlmResult,
  LlmUsageMeter,
  LlmValidationCompleted,
  LlmInputPart,
  LlmOutputPart,
  ValidateLlmInputMessage,
} from "llm-contracts";

export { llmDebugMessageDescriptors } from "./actors/llms/shape.ts";

export type { BuildLlmSubsystemOptions, CompletedLlmRequest, LlmPendingGatewayRequest, LlmRequestRetentionPolicy, LlmRequestWorkerAwaiting, LlmRequestWorkerMessage, LlmRequestWorkerState, LlmsMessage, LlmsState, LlmModelMessage, LlmModelState, LlmProviderMessage, LlmProviderState, QueuedRequest, RegisterAvailableLlmMessage, RunningRequest } from "./actors/llms/types.ts";

export function buildLlmSubsystemDefinitions(args: { readonly registry: AvenRegistry; readonly ActorKind: typeof import("../../runtime/src/spine.ts").ActorKind; readonly options?: BuildLlmSubsystemOptions; }) {
  return buildPreparedLlmSubsystemBundle(args).definitions satisfies Pick<ActorDefinitionMap<typeof args.registry>, typeof args.ActorKind.Llms | typeof args.ActorKind.LlmProvider | typeof args.ActorKind.LlmModel | typeof args.ActorKind.LlmRequestWorker>;
}


export function buildLlmSubsystemPresentations(args: { readonly registry: AvenRegistry; readonly ActorKind: typeof import("../../runtime/src/spine.ts").ActorKind; readonly options?: BuildLlmSubsystemOptions; }): ActorTreePresentationMap<typeof args.registry> {
  return buildPreparedLlmSubsystemBundle(args).presentations satisfies ActorTreePresentationMap<typeof args.registry>;
}
