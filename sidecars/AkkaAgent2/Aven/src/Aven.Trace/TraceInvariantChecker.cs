using System.Text.Json.Nodes;

namespace Aven.Trace;

public sealed class TraceInvariantChecker
{
    private readonly TraceStore _store;
    private readonly TimeSpan _defaultThreshold;
    public TraceInvariantChecker(TraceStore store, TimeSpan? defaultThreshold = null)
    {
        _store = store;
        _defaultThreshold = defaultThreshold ?? TimeSpan.FromSeconds(60);
    }

    public async Task<IReadOnlyList<TraceInvariantDto>> GetStuckAsync(TraceStuckQueryOptions options, CancellationToken cancellationToken)
    {
        var limit = TraceStore.NormalizeLimit(options.Limit);
        var threshold = options.OlderThan ?? _defaultThreshold;
        var olderThan = DateTimeOffset.UtcNow - threshold;
        var results = new List<TraceInvariantDto>();

        foreach (var delivery in await _store.QueryEntitiesAsync("delivery", "status not in ('accepted','rejected','cancelled','expired','quarantined')", olderThan, limit, cancellationToken))
        {
            results.Add(ToInvariant("INV-001", "warning", delivery, $"Delivery '{delivery.EntityId}' is still {delivery.Status} after {threshold.TotalSeconds:n0}s."));
        }
        foreach (var llm in await _store.QueryEntitiesAsync("llm_request", "status not in ('succeeded','failed','rejected')", olderThan, limit, cancellationToken))
        {
            results.Add(ToInvariant("INV-004", "warning", llm, $"LLM request '{llm.EntityId}' is still {llm.Status} after {threshold.TotalSeconds:n0}s."));
        }

        return results.Take(limit).ToArray();
    }

    public Task<IReadOnlyList<TraceInvariantDto>> ValidateInvariantsAsync(CancellationToken cancellationToken) =>
        GetStuckAsync(new TraceStuckQueryOptions(), cancellationToken);

    private static TraceInvariantDto ToInvariant(string id, string severity, TraceEntityRecord entity, string message) => new(
        $"{id}:{entity.EntityType}:{entity.EntityId}", severity, "open", entity.EntityType, entity.EntityId, message,
        entity.LastChangedAt, DateTimeOffset.UtcNow, JsonNode.Parse(entity.DetailsJson));
}