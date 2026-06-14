using Akka.Actor;
using Aven.ActorKernel;

namespace Aven.Capabilities.Actors;

public sealed class CapabilityGrantRegistryActor : AvenPersistentActor
{
    private readonly Dictionary<CapabilityId, CapabilityGrant> _grants = new();
    private readonly Dictionary<CapabilityId, HashSet<OperationKey>> _consumedOperationKeys = new();

    public CapabilityGrantRegistryActor(string persistenceId)
    {
        PersistenceId = persistenceId;

        Command<CapabilityUpsertGrantCommand>(command =>
        {
            var replyTo = Sender;
            var evt = new CapabilityGrantRegisteredOrUpdated(
                command.Grant.Id,
                command.Grant.Holder,
                command.Grant.Target,
                command.Grant.AllowedMessageTypes.OrderBy(static value => value, StringComparer.Ordinal).ToArray(),
                command.Grant.Constraints.BudgetLimit,
                command.Grant.Constraints.MaxUses,
                command.Grant.Constraints.Metadata is null
                    ? null
                    : command.Grant.Constraints.Metadata
                        .OrderBy(static pair => pair.Key, StringComparer.Ordinal)
                        .ToDictionary(static pair => pair.Key, static pair => pair.Value, StringComparer.Ordinal),
                null,
                command.Grant.CanDelegate,
                command.Grant.ParentCapabilityId,
                command.Grant.ExpiresAt,
                command.Grant.RevokedAt);
            PersistEvent(evt, MetadataFor<CapabilityGrantRegisteredOrUpdated>(
                new ActorAddress("capability/authority", "local"),
                nameof(CapabilityGrantRegistryActor),
                ActorLocalCorrelationId(),
                evt), e =>
            {
                Apply(e);
                replyTo.Tell(e);
            });
        });

        Command<CapabilityAdmitCommand>(command => HandleAdmit(command.Request));

        RecoverEvent<CapabilityGrantRegisteredOrUpdated>(Apply);
        RecoverEvent<CapabilityUseAdmitted>(Apply);
    }

    public override string PersistenceId { get; }

    private void HandleAdmit(CapabilityAdmissionRequest request)
    {
        if (!_grants.TryGetValue(request.CapabilityId, out var grant))
        {
            Sender.Tell(Reject(request, "capability_missing", "Capability grant was not found."));
            return;
        }

        if (grant.RevokedAt is not null && grant.RevokedAt <= request.RequestedAt)
        {
            Sender.Tell(Reject(request, "capability_revoked", "Capability has been revoked."));
            return;
        }

        if (grant.Holder != request.OperationKey.Caller)
        {
            Sender.Tell(Reject(request, "capability_wrong_holder", "Capability holder does not match the operation caller."));
            return;
        }

        if (grant.Target != request.Target)
        {
            Sender.Tell(Reject(request, "capability_wrong_target", "Capability target does not match the requested target."));
            return;
        }

        if (!grant.AllowedMessageTypes.Contains(request.MessageType, StringComparer.Ordinal))
        {
            Sender.Tell(Reject(request, "capability_message_not_allowed", "Capability does not allow this message type."));
            return;
        }

        if (grant.ExpiresAt is not null && grant.ExpiresAt <= request.RequestedAt)
        {
            Sender.Tell(Reject(request, "capability_expired", "Capability has expired."));
            return;
        }

        if (!CapabilityPolicy.DelegationIsValid(grant, _grants, out var delegationErrorCode, out var delegationErrorMessage))
        {
            Sender.Tell(Reject(request, delegationErrorCode, delegationErrorMessage));
            return;
        }

        if (!CapabilityPolicy.CaveatsAreSatisfied(grant, request, out var caveatErrorCode, out var caveatErrorMessage))
        {
            Sender.Tell(Reject(request, caveatErrorCode, caveatErrorMessage));
            return;
        }

        var consumed = _consumedOperationKeys[grant.Id];
        if (consumed.Contains(request.OperationKey))
        {
            Sender.Tell(new CapabilityAdmitted(grant.Id, request.OperationKey, consumed.Count));
            return;
        }

        if (grant.Constraints.MaxUses is int maxUses && consumed.Count >= maxUses)
        {
            Sender.Tell(Reject(request, "capability_max_uses_exceeded", "Capability max uses exceeded."));
            return;
        }

        var replyTo = Sender;
        var admittedAt = DateTimeOffset.UtcNow;
        var evt = new CapabilityUseAdmitted(grant.Id, request.OperationKey, admittedAt);
        PersistEvent(evt, MetadataFor<CapabilityUseAdmitted>(
            new ActorAddress("capability/authority", "local"),
            nameof(CapabilityGrantRegistryActor),
            new CorrelationId($"corr-{request.OperationKey.RequestId.Value}"),
            evt,
            operationKey: request.OperationKey,
            occurredAt: admittedAt), e =>
        {
            Apply(e);
            replyTo.Tell(new CapabilityAdmitted(grant.Id, request.OperationKey, _consumedOperationKeys[grant.Id].Count));
        });
    }

    private void Apply(CapabilityGrantRegisteredOrUpdated upserted)
    {
        var grant = new CapabilityGrant(
            upserted.Id,
            upserted.Holder,
            upserted.Target,
            new HashSet<string>(upserted.AllowedMessageTypes, StringComparer.Ordinal),
            new CapabilityConstraints(upserted.MaxUses, upserted.MaxCost, upserted.Metadata),
            upserted.CanDelegate,
            upserted.ParentCapabilityId,
            upserted.ExpiresAt,
            upserted.RevokedAt);
        _grants[grant.Id] = grant;
        if (!_consumedOperationKeys.ContainsKey(grant.Id))
        {
            _consumedOperationKeys[grant.Id] = new HashSet<OperationKey>();
        }
    }

    private void Apply(CapabilityUseAdmitted recorded)
    {
        if (!_consumedOperationKeys.TryGetValue(recorded.CapabilityId, out var consumed))
        {
            consumed = new HashSet<OperationKey>();
            _consumedOperationKeys[recorded.CapabilityId] = consumed;
        }

        consumed.Add(recorded.OperationKey);
    }

    private static CapabilityRejected Reject(CapabilityAdmissionRequest request, string code, string message) =>
        new(request.CapabilityId, request.OperationKey, new OperationError(code, message, false));
}
