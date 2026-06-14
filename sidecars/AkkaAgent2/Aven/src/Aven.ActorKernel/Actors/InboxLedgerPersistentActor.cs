namespace Aven.ActorKernel.Actors;

public abstract class InboxLedgerPersistentActor : AvenPersistentActor
{
    private readonly ProcessedCommandLedger _processedCommands = new();

    protected InboxLedgerPersistentActor(string persistenceId)
    {
        PersistenceId = persistenceId;

        RecoverEvent<InboxCommandAccepted>(Apply);
    }

    public override string PersistenceId { get; }

    protected IReadOnlyDictionary<CommandId, ProcessedCommandEntry> ProcessedCommands => _processedCommands.Entries;

    protected ProcessedCommandDecision Decide(CommandId commandId, string payloadHash) =>
        _processedCommands.Decide(commandId, payloadHash);

    protected void PersistAcceptance(InboxCommandAccepted accepted, Action<InboxCommandAccepted>? afterPersist = null)
    {
        PersistEvent(
            accepted,
            MetadataFor<InboxCommandAccepted>(
                new ActorAddress($"inbox-ledger/{Sanitize(PersistenceId)}", "local"),
                GetType().Name,
                ActorLocalCorrelationId(),
                accepted,
                commandId: accepted.CommandId,
                occurredAt: accepted.AcceptedAt),
            persisted =>
            {
                Apply(persisted);
                afterPersist?.Invoke(persisted);
            });
    }

    protected void PersistAcceptance(ProcessedCommandAccepted accepted, Action<ProcessedCommandAccepted>? afterPersist = null)
    {
        var semantic = new InboxCommandAccepted(
            accepted.CommandId,
            accepted.PayloadHash,
            accepted.AcceptedAt,
            accepted.AcceptanceSummary);

        PersistAcceptance(semantic, persisted =>
        {
            afterPersist?.Invoke(new ProcessedCommandAccepted(
                persisted.CommandId,
                persisted.PayloadHash,
                persisted.AcceptedAt,
                persisted.ResultKind));
        });
    }

    private void Apply(InboxCommandAccepted accepted)
    {
        _processedCommands.Record(new ProcessedCommandEntry(
            accepted.CommandId,
            accepted.PayloadHash,
            accepted.AcceptedAt,
            accepted.ResultKind));
    }
}
