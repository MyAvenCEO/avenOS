namespace Aven.Submission.Contracts.Commands;

public sealed record SubmitMessageRequest(
    string IdempotencyKey,
    string IncomingItemRef,
    string InputType,
    IReadOnlyList<string> AttachmentRefs,
    string ContentSummary,
    string ProposedIntent,
    string ProposedReason,
    IReadOnlyList<SchemaRef> RequiredSchemas);
