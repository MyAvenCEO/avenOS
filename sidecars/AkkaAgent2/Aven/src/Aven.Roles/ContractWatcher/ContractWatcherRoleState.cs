namespace Aven.Roles.ContractWatcher;

public sealed record ContractWatcherRoleState(
    IReadOnlyList<ContractWatcherDocumentCommand> ReceivedDocuments,
    ContractWatcherExtractedDocument? LatestContract,
    IReadOnlyList<string> ReminderIds,
    string? LatestSummaryJson)
{
    public static ContractWatcherRoleState Empty { get; } = new(Array.Empty<ContractWatcherDocumentCommand>(), null, Array.Empty<string>(), null);
}
