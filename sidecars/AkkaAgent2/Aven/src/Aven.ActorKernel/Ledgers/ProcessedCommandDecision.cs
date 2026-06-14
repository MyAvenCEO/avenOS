namespace Aven.ActorKernel.Ledgers;

public sealed record ProcessedCommandDecision(
    ProcessedCommandDecisionKind Kind,
    ProcessedCommandEntry? ExistingEntry = null);
