using Microsoft.Data.Sqlite;
using Aven.Contracts.Protocol;

namespace Aven.Trace;

public sealed class TraceQueryService : ITraceQueryService
{
    private readonly TraceStore _store;
    private readonly TraceInvariantChecker _checker;
    public TraceQueryService(TraceStore store, TraceInvariantChecker? checker = null)
    {
        _store = store;
        _checker = checker ?? new TraceInvariantChecker(store);
    }

    public Task<TraceTimelineResult> GetCorrelationTimelineAsync(string correlationId, TraceQueryOptions options, CancellationToken cancellationToken) =>
        TimelineAsync("correlation", correlationId, "correlation_id=$id", c => BindCommon(c, correlationId, options), options, cancellationToken);

    public Task<TraceTimelineResult> GetAgentTimelineAsync(string agentId, TraceQueryOptions options, CancellationToken cancellationToken) =>
        TimelineByLinkedEntityAsync("agent", agentId, options, cancellationToken);

    public Task<TraceTimelineResult> GetScheduleTimelineAsync(string scheduleId, TraceQueryOptions options, CancellationToken cancellationToken) =>
        TimelineByLinkedEntityAsync(ResourceKinds.Schedule, scheduleId, options, cancellationToken);

    public Task<TraceTimelineResult> GetRoutingTimelineAsync(string routingAttemptId, TraceQueryOptions options, CancellationToken cancellationToken) =>
        TimelineByLinkedEntityAsync("routing_attempt", routingAttemptId, options, cancellationToken);

    public async Task<TraceEntityDetail?> GetDeliveryAsync(string deliveryId, CancellationToken cancellationToken)
    {
        var entity = await _store.GetEntityAsync("delivery", deliveryId, cancellationToken);
        if (entity is null) return null;
        var timeline = await TimelineByLinkedEntityAsync("delivery", deliveryId, new TraceQueryOptions(), cancellationToken);
        return new TraceEntityDetail(new TraceSubjectDto("delivery", deliveryId), entity.Status, entity.Summary, TraceStore.ParseDetails(entity.DetailsJson), timeline);
    }

    public async Task<TraceEntityDetail?> GetLlmRequestAsync(string llmRequestId, CancellationToken cancellationToken)
    {
        var entity = await _store.GetEntityAsync("llm_request", llmRequestId, cancellationToken);
        if (entity is null) return null;
        var timeline = await TimelineByLinkedEntityAsync("llm_request", llmRequestId, new TraceQueryOptions(), cancellationToken);
        return new TraceEntityDetail(new TraceSubjectDto("llm_request", llmRequestId), entity.Status, entity.Summary, TraceStore.ParseDetails(entity.DetailsJson), timeline);
    }

    public Task<IReadOnlyList<TraceInvariantDto>> GetStuckAsync(TraceStuckQueryOptions options, CancellationToken cancellationToken) =>
        _checker.GetStuckAsync(options, cancellationToken);

    public Task<IReadOnlyList<TraceInvariantDto>> ValidateInvariantsAsync(CancellationToken cancellationToken) =>
        _checker.ValidateInvariantsAsync(cancellationToken);

    private Task<TraceTimelineResult> TimelineByLinkedEntityAsync(string entityType, string entityId, TraceQueryOptions options, CancellationToken cancellationToken) =>
        TimelineAsync(entityType, entityId,
            "(event_id in (select event_id from trace_links where (from_entity_type=$entityType and from_entity_id=$entityId) or (to_entity_type=$entityType and to_entity_id=$entityId)) or correlation_id in (select from_entity_id from trace_links where from_entity_type='correlation' and to_entity_type=$entityType and to_entity_id=$entityId))",
            c => { c.Parameters.AddWithValue("$entityType", entityType); c.Parameters.AddWithValue("$entityId", entityId); BindRange(c, options); },
            options,
            cancellationToken);

    private async Task<TraceTimelineResult> TimelineAsync(string subjectType, string subjectId, string where, Action<SqliteCommand> bind, TraceQueryOptions options, CancellationToken cancellationToken)
    {
        var bounded = options with { Limit = TraceStore.NormalizeLimit(options.Limit) };
        var withRange = AddRange(where, bounded);
        var rows = (await _store.QueryEventsAsync(withRange, bind, bounded, cancellationToken)).ToList();
        var hasMore = rows.Count > bounded.Limit;
        if (hasMore) rows = rows.Take(bounded.Limit).ToList();
        var items = rows.Select(e => new TraceTimelineItemDto(
            e.OccurredAt, e.EventId, e.EventType, e.ActorAddress, e.ActorKind, e.Summary, e.CorrelationId, e.CommandId, e.DeliveryId, e.OperationKey,
            bounded.IncludeDetails ? TraceStore.ParseDetails(e.DetailsJson) : null)).ToArray();
        var links = (await _store.GetLinksForSubjectAsync(subjectType, subjectId, bounded.Limit, cancellationToken))
            .Select(l => new TraceLinkDto(new TraceEntityRefDto(l.FromEntityType, l.FromEntityId), new TraceEntityRefDto(l.ToEntityType, l.ToEntityId), l.LinkType))
            .ToArray();
        var status = items.Length == 0 ? "not_found" : "ok";
        return new TraceTimelineResult(new TraceSubjectDto(subjectType, subjectId), status, $"{items.Length} trace event(s) for {subjectType} {subjectId}.", items, links, Array.Empty<TraceInvariantDto>(), bounded.Limit, items.Length, hasMore);
    }

    private static string AddRange(string where, TraceQueryOptions options)
    {
        if (options.From is not null) where += " and occurred_at >= $from";
        if (options.To is not null) where += " and occurred_at <= $to";
        return where;
    }

    private static void BindCommon(SqliteCommand command, string id, TraceQueryOptions options)
    {
        command.Parameters.AddWithValue("$id", id);
        BindRange(command, options);
    }

    private static void BindRange(SqliteCommand command, TraceQueryOptions options)
    {
        if (options.From is not null) command.Parameters.AddWithValue("$from", TraceStore.FormatTime(options.From.Value));
        if (options.To is not null) command.Parameters.AddWithValue("$to", TraceStore.FormatTime(options.To.Value));
    }
}