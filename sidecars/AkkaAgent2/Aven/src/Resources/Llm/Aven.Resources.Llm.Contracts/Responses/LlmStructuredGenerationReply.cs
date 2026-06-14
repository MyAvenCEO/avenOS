namespace Aven.Resources.Llm.Contracts.Responses;

public abstract record LlmStructuredGenerationReply;

public sealed record LlmStructuredGenerationSucceeded(
    OperationKey Key,
    CorrelationId CorrelationId,
    LlmResponse Response,
    string StructuredJson)
    : LlmStructuredGenerationReply;

public sealed record LlmStructuredGenerationRejected(OperationError Error)
    : LlmStructuredGenerationReply;

public sealed record LlmStructuredGenerationFailed(OperationError Error)
    : LlmStructuredGenerationReply;