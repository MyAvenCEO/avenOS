namespace Aven.ActorKernel.Ledgers;

public enum ProcessedCommandDecisionKind
{
    Accepted,
    Duplicate,
    Conflict
}
