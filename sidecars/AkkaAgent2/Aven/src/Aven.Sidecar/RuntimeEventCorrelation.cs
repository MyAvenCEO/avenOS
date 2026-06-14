using System.Collections.Concurrent;

namespace Aven.Sidecar;

/// <summary>App correlation captured at submit time so runtime events can carry the UI's reply id.</summary>
public sealed record ReplyCorrelation(string ReplyId, string MessageId, string IdentityId);

/// <summary>
/// Maps a runtime <c>CorrelationId</c> (<c>corr-{idempotencyKey}</c>) to the app's reply row id.
/// Populated when <c>messages.submit</c> is accepted; read by <see cref="RuntimeEventProjector"/>
/// to attach <c>replyId</c> to each emitted live event (milestone plan M8 correlation).
/// </summary>
public sealed class RuntimeEventCorrelation
{
    private readonly ConcurrentDictionary<string, ReplyCorrelation> _byCorrelationId = new(StringComparer.Ordinal);

    public void Register(string correlationId, ReplyCorrelation correlation) =>
        _byCorrelationId[correlationId] = correlation;

    public ReplyCorrelation? Resolve(string correlationId) =>
        _byCorrelationId.TryGetValue(correlationId, out var correlation) ? correlation : null;

    public void Forget(string correlationId) => _byCorrelationId.TryRemove(correlationId, out _);
}
