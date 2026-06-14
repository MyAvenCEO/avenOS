using System.Text.Json.Nodes;

namespace Aven.Toolkit.Tracing.Tests;

public sealed class TraceReadModelTests
{
    [Fact]
    public void TracePortableDtos_Retain_Contract_Compatible_Shape()
    {
        var now = DateTimeOffset.UtcNow;
        var invariant = new TraceInvariantDto(
            "stuck:delivery:1",
            "warning",
            "open",
            "delivery",
            "1",
            "still waiting",
            now,
            now,
            null);
        var health = new TraceProjectionHealth(true, 10, 9, 0, null, 1, false, 0, 0);
        var detail = new TraceEntityDetail(
            new TraceSubjectDto("delivery", "1"),
            "ok",
            "summary",
            JsonNode.Parse("{\"deliveryState\":\"open\"}"),
            new TraceTimelineResult(new TraceSubjectDto("delivery", "1"), "ok", "summary", [], [], [], 50, 0, false));

        Assert.True(health.Healthy);
        Assert.Equal("stuck:delivery:1", invariant.InvariantId);
        Assert.Equal(10, health.EventsSeen);
        Assert.Equal(9, health.EventsWritten);
        Assert.Equal(0, health.FailureCount);
        Assert.Null(health.LastError);
        Assert.Equal(1, health.BufferedEvents);
        Assert.False(health.FlushInProgress);
        Assert.Equal(0, health.EventsDropped);
        Assert.Equal(0, health.ManualFlushesRejected);

        Assert.Equal("1", detail.Subject.Id);
        Assert.Equal("ok", detail.Status);
        Assert.Equal("summary", detail.Summary);
        Assert.Equal("open", detail.Details!["deliveryState"]!.GetValue<string>());
        Assert.Equal("ok", detail.Timeline.Status);
    }
}