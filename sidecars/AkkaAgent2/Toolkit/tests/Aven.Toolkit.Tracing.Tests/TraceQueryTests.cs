using System.Text.Json.Nodes;

namespace Aven.Toolkit.Tracing.Tests;

public sealed class TraceQueryTests
{
    [Fact]
    public void TraceQuery_And_Projection_Options_Expose_Defaults_And_Custom_Values()
    {
        var defaultQuery = new TraceQueryOptions();
        var customQuery = new TraceQueryOptions(
            Limit: 25,
            From: new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero),
            To: new DateTimeOffset(2026, 1, 2, 0, 0, 0, TimeSpan.Zero),
            IncludeDetails: false);
        var defaultStuck = new TraceStuckQueryOptions();
        var customStuck = new TraceStuckQueryOptions(Limit: 10, OlderThan: TimeSpan.FromMinutes(30));
        var projection = new TraceProjectionOptions(
            BatchSize: 64,
            FlushInterval: TimeSpan.FromSeconds(5),
            MaxBufferedEvents: 2048,
            MaxManualFlushWaiters: 8);

        Assert.Equal(200, defaultQuery.Limit);
        Assert.Null(defaultQuery.From);
        Assert.Null(defaultQuery.To);
        Assert.True(defaultQuery.IncludeDetails);

        Assert.Equal(25, customQuery.Limit);
        Assert.Equal(new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero), customQuery.From);
        Assert.Equal(new DateTimeOffset(2026, 1, 2, 0, 0, 0, TimeSpan.Zero), customQuery.To);
        Assert.False(customQuery.IncludeDetails);

        Assert.Equal(200, defaultStuck.Limit);
        Assert.Null(defaultStuck.OlderThan);
        Assert.Equal(10, customStuck.Limit);
        Assert.Equal(TimeSpan.FromMinutes(30), customStuck.OlderThan);

        Assert.Equal(64, projection.BatchSize);
        Assert.Equal(TimeSpan.FromSeconds(5), projection.FlushInterval);
        Assert.Equal(2048, projection.MaxBufferedEvents);
        Assert.Equal(8, projection.MaxManualFlushWaiters);
    }

    [Fact]
    public void TraceTimelineResult_Retains_Complete_Portable_Shape()
    {
        var itemAt = new DateTimeOffset(2026, 6, 10, 10, 0, 0, TimeSpan.Zero);
        var item = new TraceTimelineItemDto(
            itemAt,
            "evt-1",
            "Created",
            "trace/projection",
            "projection",
            "Created",
            "corr-1",
            "cmd-1",
            "delivery-1",
            "op-1",
            JsonNode.Parse("{\"step\":1}"));
        var link = new TraceLinkDto(new TraceEntityRefDto("delivery", "delivery-1"), new TraceEntityRefDto("agent", "agent-1"), "owned-by");
        var invariant = new TraceInvariantDto(
            "inv-1",
            "warning",
            "open",
            "delivery",
            "delivery-1",
            "still pending",
            itemAt,
            itemAt.AddMinutes(5),
            JsonNode.Parse("{\"ageMinutes\":5}"));
        var result = new TraceTimelineResult(
            new TraceSubjectDto("correlation", "corr-1"),
            "complete",
            "summary",
            [item],
            [link],
            [invariant],
            Limit: 50,
            Count: 1,
            HasMore: false);

        Assert.Equal(itemAt, item.At);
        Assert.Equal("evt-1", item.EventId);
        Assert.Equal("Created", item.EventType);
        Assert.Equal("trace/projection", item.Actor);
        Assert.Equal("projection", item.ActorKind);
        Assert.Equal("Created", item.Summary);
        Assert.Equal("corr-1", item.CorrelationId);
        Assert.Equal("cmd-1", item.CommandId);
        Assert.Equal("delivery-1", item.DeliveryId);
        Assert.Equal("op-1", item.OperationKey);
        Assert.Equal(1, item.Details!["step"]!.GetValue<int>());

        Assert.Equal("corr-1", result.Subject.Id);
        Assert.Equal("complete", result.Status);
        Assert.Equal("summary", result.Summary);
        Assert.Single(result.Items);
        Assert.Single(result.Links);
        Assert.Single(result.Invariants);
        Assert.Equal(50, result.Limit);
        Assert.Equal(1, result.Count);
        Assert.False(result.HasMore);

        Assert.Equal("delivery", result.Links[0].From.Type);
        Assert.Equal("delivery-1", result.Links[0].From.Id);
        Assert.Equal("agent", result.Links[0].To.Type);
        Assert.Equal("agent-1", result.Links[0].To.Id);
        Assert.Equal("owned-by", result.Links[0].Type);

        Assert.Equal("inv-1", result.Invariants[0].InvariantId);
        Assert.Equal("warning", result.Invariants[0].Severity);
        Assert.Equal("open", result.Invariants[0].Status);
        Assert.Equal("delivery", result.Invariants[0].EntityType);
        Assert.Equal("delivery-1", result.Invariants[0].EntityId);
        Assert.Equal("still pending", result.Invariants[0].Message);
        Assert.Equal(itemAt, result.Invariants[0].FirstSeenAt);
        Assert.Equal(itemAt.AddMinutes(5), result.Invariants[0].LastSeenAt);
        Assert.Equal(5, result.Invariants[0].Details!["ageMinutes"]!.GetValue<int>());
    }
}