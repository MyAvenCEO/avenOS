using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Aven.Sidecar.Protocol;

namespace Aven.Tests.Sidecar;

public sealed class EnvelopeSerializationTests
{
    [Fact]
    public void Serializes_response_result_envelope_without_null_slots()
    {
        var envelope = ProtocolEnvelope.ResponseResult("req_1", new JsonObject { ["accepted"] = true, ["runId"] = "run_abc" });

        var json = JsonSerializer.Serialize(envelope, ProtocolConstants.Json);

        Assert.Contains("\"kind\":\"response\"", json);
        Assert.Contains("\"id\":\"req_1\"", json);
        Assert.Contains("\"result\":", json);
        Assert.Contains("\"accepted\":true", json);
        // Absent slots must not appear at all.
        Assert.DoesNotContain("\"error\":", json);
        Assert.DoesNotContain("\"params\":", json);
        Assert.DoesNotContain("\"event\":", json);
        Assert.DoesNotContain("\"method\":", json);
    }

    [Fact]
    public void Serializes_event_envelope()
    {
        var envelope = ProtocolEnvelope.EventMessage(
            ProtocolEvents.AgentMessageCompleted,
            new JsonObject { ["replyId"] = "ui-reply-1", ["text"] = "done" });

        var json = JsonSerializer.Serialize(envelope, ProtocolConstants.Json);

        Assert.Contains("\"kind\":\"event\"", json);
        Assert.Contains("\"method\":\"agent.message.completed\"", json);
        Assert.Contains("\"event\":", json);
        Assert.DoesNotContain("\"id\":", json);
    }

    [Fact]
    public void Serializes_error_envelope_with_machine_code()
    {
        var envelope = ProtocolEnvelope.ResponseError(
            "req_2",
            new ProtocolError(ProtocolErrorCodes.AgentNotFound, "Agent 'x' was not found.", retryable: false,
                data: new JsonObject { ["agentId"] = "x" }));

        var json = JsonSerializer.Serialize(envelope, ProtocolConstants.Json);

        Assert.Contains("\"error\":", json);
        Assert.Contains("\"code\":\"agent_not_found\"", json);
        Assert.Contains("\"retryable\":false", json);
        Assert.Contains("\"agentId\":\"x\"", json);
        Assert.DoesNotContain("\"result\":", json);
    }

    [Fact]
    public async Task Round_trips_through_framing()
    {
        var original = ProtocolEnvelope.Request(
            "req_3",
            ProtocolMethods.MessagesSubmit,
            new JsonObject { ["message"] = "Plan my day", ["inputType"] = "chat" },
            new JsonObject { ["caller"] = "tauri" });

        var framed = MessageFraming.Encode(original);
        var decoded = await FramingCodec.DecodeAllAsync(framed);

        var envelope = Assert.Single(decoded);
        Assert.Equal(ProtocolKind.Request, envelope.Kind);
        Assert.Equal("req_3", envelope.Id);
        Assert.Equal("messages.submit", envelope.Method);
        Assert.Equal("Plan my day", envelope.Params!["message"]!.GetValue<string>());
        Assert.Equal("tauri", envelope.Meta!["caller"]!.GetValue<string>());
    }
}

public sealed class ProtocolValidationTests
{
    [Fact]
    public void Valid_request_passes()
    {
        var envelope = ProtocolEnvelope.Request("id_1", ProtocolMethods.SessionPing);
        Assert.True(ProtocolValidation.TryValidate(envelope, out var error));
        Assert.Null(error);
    }

    [Fact]
    public void Valid_response_result_passes()
    {
        var envelope = ProtocolEnvelope.ResponseResult("id_1", new JsonObject { ["ok"] = true });
        Assert.True(ProtocolValidation.TryValidate(envelope, out _));
    }

    [Fact]
    public void Valid_event_passes()
    {
        var envelope = ProtocolEnvelope.EventMessage(ProtocolEvents.RuntimeHealth, new JsonObject { ["ok"] = true });
        Assert.True(ProtocolValidation.TryValidate(envelope, out _));
    }

    [Fact]
    public void Rejects_wrong_version()
    {
        var envelope = new ProtocolEnvelope { V = 2, Kind = ProtocolKind.Request, Id = "i", Method = "m" };
        Assert.False(ProtocolValidation.TryValidate(envelope, out var error));
        Assert.Contains("version", error!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Rejects_missing_kind()
    {
        var envelope = new ProtocolEnvelope { Kind = null };
        Assert.False(ProtocolValidation.TryValidate(envelope, out var error));
        Assert.Contains("kind", error!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Rejects_request_without_id()
    {
        var envelope = new ProtocolEnvelope { Kind = ProtocolKind.Request, Method = "session.ping" };
        Assert.False(ProtocolValidation.TryValidate(envelope, out var error));
        Assert.Contains("id", error!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Rejects_request_without_method()
    {
        var envelope = new ProtocolEnvelope { Kind = ProtocolKind.Request, Id = "i" };
        Assert.False(ProtocolValidation.TryValidate(envelope, out var error));
        Assert.Contains("method", error!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Rejects_response_with_both_result_and_error()
    {
        var envelope = new ProtocolEnvelope
        {
            Kind = ProtocolKind.Response,
            Id = "i",
            Result = new JsonObject(),
            Error = new ProtocolError("x", "y"),
        };
        Assert.False(ProtocolValidation.TryValidate(envelope, out var error));
        Assert.Contains("result", error!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Rejects_response_with_neither_result_nor_error()
    {
        var envelope = new ProtocolEnvelope { Kind = ProtocolKind.Response, Id = "i" };
        Assert.False(ProtocolValidation.TryValidate(envelope, out _));
    }

    [Fact]
    public void Rejects_event_without_event_payload()
    {
        var envelope = new ProtocolEnvelope { Kind = ProtocolKind.Event, Method = "x" };
        Assert.False(ProtocolValidation.TryValidate(envelope, out var error));
        Assert.Contains("event", error!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Validate_throws_on_invalid()
    {
        var envelope = new ProtocolEnvelope { Kind = null };
        Assert.Throws<ProtocolValidationException>(() => ProtocolValidation.Validate(envelope));
    }
}
