namespace Aven.ActorKernel.Ledgers;

public sealed record ProcessedCommandEntry(
    CommandId CommandId,
    string PayloadHash,
    DateTimeOffset AcceptedAt,
    string AcceptanceSummary);
