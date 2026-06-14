namespace Aven.ActorKernel.State;

public sealed record TerminalState<TValue, TAckMetadata>
{
    public bool IsTerminal { get; init; }
    public TValue? Value { get; init; }
    public TAckMetadata? AckMetadata { get; init; }

    public TerminalSetResult<TValue> TrySet(TValue value)
    {
        if (!IsTerminal)
        {
            return new TerminalSetResult<TValue>(TerminalSetStatus.Applied, default, value);
        }

        return EqualityComparer<TValue>.Default.Equals(Value, value)
            ? new TerminalSetResult<TValue>(TerminalSetStatus.Idempotent, Value, value)
            : new TerminalSetResult<TValue>(TerminalSetStatus.Conflict, Value, value);
    }

    public TerminalState<TValue, TAckMetadata> ApplySet(TValue value)
    {
        var result = TrySet(value);
        return result.Status switch
        {
            TerminalSetStatus.Applied => this with { IsTerminal = true, Value = value },
            TerminalSetStatus.Idempotent => this,
            TerminalSetStatus.Conflict => this,
            _ => throw new ArgumentOutOfRangeException(nameof(result.Status), result.Status, null)
        };
    }

    public TerminalState<TValue, TAckMetadata> WithAckMetadata(TAckMetadata ackMetadata)
    {
        if (!IsTerminal)
        {
            throw new InvalidOperationException("Ack metadata can only be attached after the terminal value is set.");
        }

        return this with { AckMetadata = ackMetadata };
    }
}
