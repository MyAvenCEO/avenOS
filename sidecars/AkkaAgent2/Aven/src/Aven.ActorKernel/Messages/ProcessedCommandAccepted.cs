namespace Aven.ActorKernel.Messages;

public sealed record ProcessedCommandAccepted(
    CommandId CommandId,
    string PayloadHash,
    DateTimeOffset AcceptedAt,
    string AcceptanceSummary);
