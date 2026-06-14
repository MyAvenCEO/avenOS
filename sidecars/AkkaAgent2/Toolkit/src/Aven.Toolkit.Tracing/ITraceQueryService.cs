namespace Aven.Toolkit.Tracing;

public interface ITraceQueryService
{
    Task<TraceTimelineResult> GetCorrelationTimelineAsync(string correlationId, TraceQueryOptions options, CancellationToken cancellationToken);
    Task<TraceTimelineResult> GetAgentTimelineAsync(string agentId, TraceQueryOptions options, CancellationToken cancellationToken);
    Task<TraceTimelineResult> GetScheduleTimelineAsync(string scheduleId, TraceQueryOptions options, CancellationToken cancellationToken);
    Task<TraceTimelineResult> GetRoutingTimelineAsync(string routingAttemptId, TraceQueryOptions options, CancellationToken cancellationToken);
    Task<TraceEntityDetail?> GetDeliveryAsync(string deliveryId, CancellationToken cancellationToken);
    Task<TraceEntityDetail?> GetLlmRequestAsync(string llmRequestId, CancellationToken cancellationToken);
    Task<IReadOnlyList<TraceInvariantDto>> GetStuckAsync(TraceStuckQueryOptions options, CancellationToken cancellationToken);
    Task<IReadOnlyList<TraceInvariantDto>> ValidateInvariantsAsync(CancellationToken cancellationToken);
}
