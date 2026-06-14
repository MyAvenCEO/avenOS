namespace Aven.Roles.ResearchWatch;

public sealed record ResearchWatchRoleState(
    IReadOnlyList<ResearchWatchDocumentCommand> ReceivedDocuments,
    ResearchWatchExtractedDocument? LatestDocument,
    IReadOnlyList<string> DigestScheduleIds,
    string? LatestDigestJson)
{
    public static ResearchWatchRoleState Empty { get; } = new(Array.Empty<ResearchWatchDocumentCommand>(), null, Array.Empty<string>(), null);
}
