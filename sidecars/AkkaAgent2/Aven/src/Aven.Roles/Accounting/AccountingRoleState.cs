namespace Aven.Roles.Accounting;

public sealed record AccountingRoleState(
    IReadOnlyList<AccountingPendingIngestion> PendingIngestions,
    IReadOnlyList<AccountingPendingDocumentStorage> PendingDocumentStores,
    IReadOnlyList<AccountingPendingMatchRefresh> PendingMatchRefreshes,
    IReadOnlyList<AccountingPendingHumanReview> PendingHumanReviews,
    IReadOnlyList<AccountingMemoryFact> Facts,
    string? LastResult)
{
    public static AccountingRoleState Empty { get; } = new(
        Array.Empty<AccountingPendingIngestion>(),
        Array.Empty<AccountingPendingDocumentStorage>(),
        Array.Empty<AccountingPendingMatchRefresh>(),
        Array.Empty<AccountingPendingHumanReview>(),
        Array.Empty<AccountingMemoryFact>(),
        null);
}

public sealed record AccountingMemoryFact(
    string Kind,
    string SubjectId,
    string? Reference,
    string? Status);

public sealed record AccountingPendingIngestion(
    string ClaimId,
    string SourceArtifactId,
    string? SourceArtifactRevisionId,
    string CorrelationId,
    string? ClassifiedDocumentKind);

public sealed record AccountingPendingDocumentStorage(
    string MetadataRequestId,
    string DocumentKind,
    string SubjectId,
    string DocumentSubjectId,
    string SchemaRef,
    string SourceArtifactId,
    string? SourceArtifactRevisionId);

public sealed record AccountingPendingMatchRefresh(
    string QueryRequestId,
    string TriggerDocumentKind,
    string TriggerSubjectId);

public sealed record AccountingPendingHumanReview(
    string PromptRequestId,
    string MatchSubjectId,
    string ApprovedPaymentMatchJson,
    string RejectedPaymentMatchJson);
