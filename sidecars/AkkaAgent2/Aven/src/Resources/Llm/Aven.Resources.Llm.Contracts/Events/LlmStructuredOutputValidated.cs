namespace Aven.Resources.Llm.Contracts.Events;

public sealed record LlmStructuredOutputValidated(
    LlmRequestId LlmRequestId,
    OperationKey Key,
    SchemaRef SchemaRef,
    bool Valid,
    string[] Errors) : IAvenEvent;
