namespace Aven.Resources.Llm.Contracts;

public sealed record LlmGenerateOperationPayload(
    string RequestId,
    ArtifactRef Artifact,
    SchemaRef SchemaRef,
    string Prompt,
    string Purpose,
    string? CapabilityId = null);