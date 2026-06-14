using Akka.Actor;
using Aven.DurableDelivery;
using Aven.Contracts.Protocol.Envelopes;

namespace Aven.RoleAgents.Runtime;

internal static class RoleAgentOperationDispatcher
{
    public static RoleAgentOperationDispatchResult DispatchPending(
        RoleAgentState state,
        IReadOnlySet<string> dispatchedOperationIds,
        IReadOnlyDictionary<string, ActorAddress> resourceGateways,
        ActorAddress selfAddress,
        string ownerPersistenceId,
        DurableDeliveryFactory deliveryLauncher,
        IUntypedActorContext context,
        Func<PendingOperationState, CorrelationId> correlationResolver)
    {
        var launched = new List<string>();

        foreach (var pendingOperation in state.PendingOperations.Values.OrderBy(static x => x.RequestedAt))
        {
            if (dispatchedOperationIds.Contains(pendingOperation.OperationId.Value))
            {
                continue;
            }

            if (!state.ActiveRuns.Values.Any(x => x.RunId == pendingOperation.RunId))
            {
                continue;
            }

            if (!resourceGateways.TryGetValue(pendingOperation.TargetKind, out var recipient))
            {
                continue;
            }

            var sanitizedOperationId = Sanitize(pendingOperation.OperationId.Value);
            var envelope = AvenEnvelopeBuilder
                .ForMessage(pendingOperation.ContractId, pendingOperation.Input.Json)
                .From(selfAddress)
                .To(recipient)
                .ReplyTo(selfAddress)
                .WithCorrelation(correlationResolver(pendingOperation))
                .WithCommandId(new CommandId($"cmd-{sanitizedOperationId}"))
                .WithMessageId(new MessageId($"msg-{sanitizedOperationId}"))
                .WithCreatedAt(pendingOperation.RequestedAt)
                .Build();

            deliveryLauncher.StartOrResume(
                context,
                ownerPersistenceId,
                DurableDeliveryStartFactory.ForEnvelope(envelope)
                    .OwnedBy(selfAddress)
                    .WithDeliveryId(new DeliveryId($"delivery-{sanitizedOperationId}"))
                    .WithPolicy(new DeliveryPolicy(TimeSpan.FromMilliseconds(50), 10))
                    .NotifyTerminal(selfAddress)
                    .Build());

            launched.Add(pendingOperation.OperationId.Value);
        }

        return new RoleAgentOperationDispatchResult(launched);
    }

    private static string Sanitize(string value)
    {
        Span<char> buffer = stackalloc char[value.Length];
        var index = 0;
        foreach (var ch in value)
        {
            buffer[index++] = char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '-';
        }

        return new string(buffer[..index]);
    }
}