using Aven.Contracts.Operations;
using Aven.Contracts.Messaging;

namespace Aven.Contracts.Protocol.Envelopes;

public static class AvenEnvelopeBuilder
{
    public static Builder<TPayload> ForMessage<TPayload>(string messageType, TPayload payload)
        => new(messageType, payload);

    public sealed class Builder<TPayload>
    {
        private readonly string _messageType;
        private readonly TPayload _payload;
        private ActorAddress? _sender;
        private ActorAddress? _recipient;
        private ActorAddress? _replyTo;
        private CorrelationId? _correlationId;
        private MessageId? _causationId;
        private CapabilityId? _capabilityId;
        private CommandId? _commandId;
        private MessageId? _messageId;
        private DateTimeOffset? _createdAt;
        private int _messageVersion = 1;

        internal Builder(string messageType, TPayload payload)
        {
            _messageType = string.IsNullOrWhiteSpace(messageType)
                ? throw new ArgumentException("Envelope message type is required.", nameof(messageType))
                : messageType;
            _payload = payload is null
                ? throw new ArgumentNullException(nameof(payload), "Envelope payload is required.")
                : payload;
        }

        public Builder<TPayload> From(ActorAddress sender)
        {
            _sender = RequireAddress(sender, nameof(sender), "Envelope sender is required.");
            return this;
        }

        public Builder<TPayload> To(ActorAddress recipient)
        {
            _recipient = RequireAddress(recipient, nameof(recipient), "Envelope recipient is required.");
            return this;
        }

        public Builder<TPayload> ReplyTo(ActorAddress replyTo)
        {
            _replyTo = RequireAddress(replyTo, nameof(replyTo), "Envelope reply-to is required.");
            return this;
        }

        public Builder<TPayload> WithCorrelation(CorrelationId correlationId)
        {
            _correlationId = RequireValue(correlationId, nameof(correlationId), "Envelope correlation id is required.");
            return this;
        }

        public Builder<TPayload> WithCausation(MessageId causationId)
        {
            _causationId = RequireValue(causationId, nameof(causationId), "Envelope causation id is required when provided.");
            return this;
        }

        public Builder<TPayload> WithCapability(CapabilityId capabilityId)
        {
            _capabilityId = RequireValue(capabilityId, nameof(capabilityId), "Envelope capability id is required when provided.");
            return this;
        }

        public Builder<TPayload> WithIdempotencyKey(OperationKey operationKey)
        {
            if (operationKey is null)
            {
                throw new ArgumentNullException(nameof(operationKey), "Envelope idempotency key is required when provided.");
            }

            _commandId = new CommandId(FormatOperationKey(operationKey));
            return this;
        }

        public Builder<TPayload> WithCommandId(CommandId commandId)
        {
            _commandId = RequireValue(commandId, nameof(commandId), "Envelope command id is required when provided.");
            return this;
        }

        public Builder<TPayload> WithMessageId(MessageId messageId)
        {
            _messageId = RequireValue(messageId, nameof(messageId), "Envelope message id is required when provided.");
            return this;
        }

        public Builder<TPayload> WithCreatedAt(DateTimeOffset createdAt)
        {
            _createdAt = createdAt;
            return this;
        }

        public Builder<TPayload> WithMessageVersion(int messageVersion)
        {
            if (messageVersion <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(messageVersion), messageVersion, "Envelope message version must be greater than zero.");
            }

            _messageVersion = messageVersion;
            return this;
        }

        public AvenEnvelope<TPayload> Build()
        {
            var sender = _sender ?? throw new InvalidOperationException("Envelope sender is required before build.");
            var recipient = _recipient ?? throw new InvalidOperationException("Envelope recipient is required before build.");
            var replyTo = _replyTo ?? throw new InvalidOperationException("Envelope reply-to is required before build.");
            var correlationId = _correlationId ?? throw new InvalidOperationException("Envelope correlation id is required before build.");
            var commandId = _commandId ?? throw new InvalidOperationException("Envelope command id is required before build. Use WithCommandId(...) or WithIdempotencyKey(...).");
            var messageId = _messageId ?? throw new InvalidOperationException("Envelope message id is required before build.");
            var createdAt = _createdAt ?? throw new InvalidOperationException("Envelope created-at timestamp is required before build.");

            return new AvenEnvelope<TPayload>(
                commandId,
                messageId,
                sender,
                recipient,
                replyTo,
                correlationId,
                _messageType,
                _messageVersion,
                _payload,
                _capabilityId,
                _causationId,
                createdAt);
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

        private static string FormatOperationKey(OperationKey key)
            => $"{key.Caller.Protocol}|{key.Caller.Value}|{key.RequestId.Value}|{key.OperationType}";
    }
}