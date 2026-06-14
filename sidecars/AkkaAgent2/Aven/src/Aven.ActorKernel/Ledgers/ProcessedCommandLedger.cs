namespace Aven.ActorKernel.Ledgers;

public sealed class ProcessedCommandLedger
{
    private readonly Dictionary<CommandId, ProcessedCommandEntry> _entries = new();

    public IReadOnlyDictionary<CommandId, ProcessedCommandEntry> Entries => _entries;

    public ProcessedCommandDecision Decide(CommandId commandId, string payloadHash)
    {
        if (!_entries.TryGetValue(commandId, out var existingEntry))
        {
            return new ProcessedCommandDecision(ProcessedCommandDecisionKind.Accepted);
        }

        return StringComparer.Ordinal.Equals(existingEntry.PayloadHash, payloadHash)
            ? new ProcessedCommandDecision(ProcessedCommandDecisionKind.Duplicate, existingEntry)
            : new ProcessedCommandDecision(ProcessedCommandDecisionKind.Conflict, existingEntry);
    }

    public void Record(ProcessedCommandEntry entry)
    {
        var decision = Decide(entry.CommandId, entry.PayloadHash);
        if (decision.Kind is ProcessedCommandDecisionKind.Conflict)
        {
            throw new InvalidOperationException(
                $"Command '{entry.CommandId.Value}' was already recorded with a different payload hash.");
        }

        _entries[entry.CommandId] = entry;
    }
}
