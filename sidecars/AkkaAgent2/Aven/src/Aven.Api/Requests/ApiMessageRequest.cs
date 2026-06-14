namespace Aven.Api.Requests;

public sealed record ApiMessageRequest(
    string IdempotencyKey,
    string IncomingItemRef,
    string InputType,
    IReadOnlyList<string>? AttachmentRefs,
    string ContentSummary,
    string ProposedIntent,
    string ProposedReason,
    IReadOnlyList<string>? RequiredSchemas);
