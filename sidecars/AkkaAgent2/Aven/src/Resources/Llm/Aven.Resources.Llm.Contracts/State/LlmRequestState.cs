namespace Aven.Resources.Llm.Contracts.State;

public sealed record LlmRequestState(
    LlmRequest Request,
    LlmRequestStatus Status,
    bool ExternalCallStarted,
    LlmResponse? Response,
    OperationError? Error)
{
    public static LlmRequestState Create(LlmRequest request) => new(request, LlmRequestStatus.Created, false, null, null);
}
