using Aven.DurableDelivery.Contracts.Models;

namespace Aven.DurableDelivery.Contracts.Protocol;

public static class DurableDeliveryStartFactory
{
    public static StartBuilder ForEnvelope(AvenEnvelope<string> envelope)
        => new(envelope);

    public sealed class StartBuilder
    {
        private readonly AvenEnvelope<string> _envelope;
        private DeliveryId? _deliveryId;
        private ActorAddress? _owner;
        private DeliveryPolicy? _policy;
        private ActorAddress? _terminalNotifyTo;

        internal StartBuilder(AvenEnvelope<string> envelope)
        {
            _envelope = envelope ?? throw new ArgumentNullException(nameof(envelope), "Durable delivery envelope is required.");

            if (string.IsNullOrWhiteSpace(envelope.Payload))
            {
                throw new ArgumentException("Durable delivery envelope payload is required.", nameof(envelope));
            }
        }

        public StartBuilder OwnedBy(ActorAddress owner)
        {
            _owner = RequireAddress(owner, nameof(owner), "Durable delivery owner is required.");
            return this;
        }

        public StartBuilder WithDeliveryId(DeliveryId deliveryId)
        {
            _deliveryId = RequireValue(deliveryId, nameof(deliveryId), "Durable delivery id is required.");
            return this;
        }

        public StartBuilder WithPolicy(DeliveryPolicy policy)
        {
            _policy = policy ?? throw new ArgumentNullException(nameof(policy), "Durable delivery policy is required.");
            return this;
        }

        public StartBuilder NotifyTerminal(ActorAddress terminalNotifyTo)
        {
            _terminalNotifyTo = RequireAddress(terminalNotifyTo, nameof(terminalNotifyTo), "Durable delivery terminal notify address is required when provided.");
            return this;
        }

        public DurableDeliveryStart Build()
        {
            var deliveryId = _deliveryId ?? throw new InvalidOperationException("Durable delivery id is required before build.");
            var owner = _owner ?? throw new InvalidOperationException("Durable delivery owner is required before build.");
            var policy = _policy ?? throw new InvalidOperationException("Durable delivery policy is required before build.");
            return new DurableDeliveryStart(
                new DurableDeliverySpec(deliveryId, owner, _envelope, policy, _terminalNotifyTo),
                new DeliveryStart(deliveryId));
        }

        private static ActorAddress RequireAddress(ActorAddress address, string paramName, string message)
        {
            if (string.IsNullOrWhiteSpace(address.Value) || string.IsNullOrWhiteSpace(address.Protocol))
            {
                throw new ArgumentException(message, paramName);
            }

            return address;
        }

        private static T RequireValue<T>(T value, string paramName, string message)
            where T : struct
        {
            var text = value.ToString();
            if (string.IsNullOrWhiteSpace(text))
            {
                throw new ArgumentException(message, paramName);
            }

            return value;
        }
    }
}

public sealed record DurableDeliveryStart(
    DurableDeliverySpec Spec,
    DeliveryStart Start);