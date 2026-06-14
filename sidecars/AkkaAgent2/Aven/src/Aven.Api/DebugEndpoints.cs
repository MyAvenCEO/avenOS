namespace Aven.Api;

public static class DebugEndpoints
{
    public static IEndpointRouteBuilder MapAvenDebugEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/debug");

        group.MapGet("/correlations/{correlationId}", async (string correlationId, int? limit, bool? includeDetails, RuntimeCompositionRoot runtime, CancellationToken ct) =>
            Results.Ok(await runtime.TraceQueryService.GetCorrelationTimelineAsync(correlationId, Options(limit, includeDetails), ct)));

        group.MapGet("/agents/{agentId}/timeline", async (string agentId, int? limit, bool? includeDetails, RuntimeCompositionRoot runtime, CancellationToken ct) =>
            Results.Ok(await runtime.TraceQueryService.GetAgentTimelineAsync(agentId, Options(limit, includeDetails), ct)));

        group.MapGet("/schedules/{scheduleId}/timeline", async (string scheduleId, int? limit, bool? includeDetails, RuntimeCompositionRoot runtime, CancellationToken ct) =>
            Results.Ok(await runtime.TraceQueryService.GetScheduleTimelineAsync(scheduleId, Options(limit, includeDetails), ct)));

        group.MapGet("/routing/{routingAttemptId}", async (string routingAttemptId, int? limit, bool? includeDetails, RuntimeCompositionRoot runtime, CancellationToken ct) =>
            Results.Ok(await runtime.TraceQueryService.GetRoutingTimelineAsync(routingAttemptId, Options(limit, includeDetails), ct)));

        group.MapGet("/deliveries/{deliveryId}", async (string deliveryId, RuntimeCompositionRoot runtime, CancellationToken ct) =>
        {
            var detail = await runtime.TraceQueryService.GetDeliveryAsync(deliveryId, ct);
            return detail is null ? Results.NotFound(new { status = "not_found", subject = new { type = "delivery", id = deliveryId } }) : Results.Ok(detail);
        });

        group.MapGet("/llm/{llmRequestId}", async (string llmRequestId, RuntimeCompositionRoot runtime, CancellationToken ct) =>
        {
            var detail = await runtime.TraceQueryService.GetLlmRequestAsync(llmRequestId, ct);
            return detail is null ? Results.NotFound(new { status = "not_found", subject = new { type = "llm_request", id = llmRequestId } }) : Results.Ok(detail);
        });

        group.MapPost("/flush", async (RuntimeCompositionRoot runtime) =>
            Results.Ok(await runtime.FlushTraceProjectionAsync()));

        group.MapGet("/stuck", async (int? limit, int? olderThanSeconds, RuntimeCompositionRoot runtime, CancellationToken ct) =>
            Results.Ok(await runtime.TraceQueryService.GetStuckAsync(new TraceStuckQueryOptions(limit ?? 200, olderThanSeconds is null ? null : TimeSpan.FromSeconds(olderThanSeconds.Value)), ct)));

        group.MapGet("/invariants", async (RuntimeCompositionRoot runtime, CancellationToken ct) =>
            Results.Ok(await runtime.TraceQueryService.ValidateInvariantsAsync(ct)));

        group.MapGet("/health", async (RuntimeCompositionRoot runtime) =>
        {
            var health = await runtime.GetTraceProjectionHealthAsync();
            return Results.Ok(new { status = health.Healthy ? "healthy" : "degraded", projection = health });
        });

        group.MapGet("/role-agent-ledger/health", async (RuntimeCompositionRoot runtime) =>
            Results.Ok(await runtime.GetRoleAgentLedgerProjectionHealthAsync()));

        return app;
    }

    private static TraceQueryOptions Options(int? limit, bool? includeDetails) => new(limit ?? 200, IncludeDetails: includeDetails ?? true);
}