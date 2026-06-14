using Akka.Actor;

namespace Aven.DurableDelivery;

public sealed class DurableDeliveryFactory
{
    private readonly IActorAddressResolver _resolver;

    public DurableDeliveryFactory(IActorAddressResolver resolver)
    {
        _resolver = resolver;
    }

    public IActorRef StartOrResume(
        IUntypedActorContext context,
        string ownerPersistenceId,
        DurableDeliverySpec spec,
        bool start = true)
    {
        if (spec is null)
        {
            throw new ArgumentNullException(nameof(spec));
        }

        var childName = ChildName(spec.DeliveryId);
        var child = context.Child(childName);

        if (child.IsNobody())
        {
            child = context.ActorOf(
                Props.Create(() => new DurableDeliveryActor(
                    PersistenceId(ownerPersistenceId, spec.DeliveryId),
                    spec.DeliveryId,
                    spec.Owner,
                    spec.Envelope,
                    PersistedCommandPayload.FromInlineJson(spec.Envelope.Payload).Hash,
                    _resolver,
                    spec.Policy.RetryDelay,
                    spec.Policy.MaxAttempts,
                    spec.Policy.ExpiresAt,
                    spec.TerminalNotifyTo)),
                childName);
        }

        if (start)
        {
            var startMessage = DurableDeliveryStartFactory.ForEnvelope(spec.Envelope)
                .OwnedBy(spec.Owner)
                .WithDeliveryId(spec.DeliveryId)
                .WithPolicy(spec.Policy);

            if (spec.TerminalNotifyTo is { } terminalNotifyTo)
            {
                startMessage = startMessage.NotifyTerminal(terminalNotifyTo);
            }

            child.Tell(startMessage.Build().Start);
        }

        return child;
    }

    public IActorRef StartOrResume(
        IUntypedActorContext context,
        string ownerPersistenceId,
        DurableDeliveryStart start,
        bool sendStart = true)
    {
        if (start is null)
        {
            throw new ArgumentNullException(nameof(start));
        }

        var child = StartOrResume(context, ownerPersistenceId, start.Spec, start: false);
        if (sendStart)
        {
            child.Tell(start.Start);
        }

        return child;
    }

    public static string PersistenceId(string ownerPersistenceId, DeliveryId deliveryId) =>
        $"{ownerPersistenceId}/delivery/{deliveryId.Value}";

    public static string ChildName(DeliveryId deliveryId) =>
        $"delivery-{SanitizeChildActorName(deliveryId.Value)}";

    private static string SanitizeChildActorName(string value)
    {
        var builder = new System.Text.StringBuilder(value.Length);
        foreach (var ch in value)
        {
            builder.Append(char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '-');
        }

        return builder.ToString();
    }
}