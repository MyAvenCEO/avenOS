using System.Text;
using System.Text.Json.Nodes;
using Aven.Sidecar.Protocol;

namespace Aven.Tests.Sidecar;

public sealed class MessageFramingTests
{
    private static byte[] Frame(string json)
    {
        var body = Encoding.UTF8.GetBytes(json);
        return MessageFraming.Encode(body);
    }

    [Fact]
    public async Task Parses_single_message()
    {
        var framed = Frame("{\"v\":1,\"kind\":\"event\",\"event\":{\"hello\":true}}");
        var envelopes = await FramingCodec.DecodeAllAsync(framed);

        var envelope = Assert.Single(envelopes);
        Assert.Equal(1, envelope.V);
        Assert.Equal(ProtocolKind.Event, envelope.Kind);
        Assert.NotNull(envelope.Event);
        Assert.True(envelope.Event!["hello"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Parses_two_messages_back_to_back()
    {
        var first = Frame("{\"v\":1,\"kind\":\"request\",\"id\":\"a\",\"method\":\"session.ping\"}");
        var second = Frame("{\"v\":1,\"kind\":\"request\",\"id\":\"b\",\"method\":\"session.hello\"}");
        var combined = new byte[first.Length + second.Length];
        first.CopyTo(combined, 0);
        second.CopyTo(combined, first.Length);

        var envelopes = await FramingCodec.DecodeAllAsync(combined);

        Assert.Equal(2, envelopes.Count);
        Assert.Equal("a", envelopes[0].Id);
        Assert.Equal("session.ping", envelopes[0].Method);
        Assert.Equal("b", envelopes[1].Id);
        Assert.Equal("session.hello", envelopes[1].Method);
    }

    [Fact]
    public async Task Parses_multiline_json_body()
    {
        // A body with real newlines inside string values and pretty-printing. Content-Length
        // framing must not care about newlines in the payload.
        var multiline = "{\n  \"v\": 1,\n  \"kind\": \"request\",\n  \"id\": \"ml\",\n  \"method\": \"messages.submit\",\n"
            + "  \"params\": { \"message\": \"line one\\nline two\\nline three\" }\n}";
        var framed = Frame(multiline);

        var envelopes = await FramingCodec.DecodeAllAsync(framed);

        var envelope = Assert.Single(envelopes);
        Assert.Equal("ml", envelope.Id);
        Assert.Equal("line one\nline two\nline three", envelope.Params!["message"]!.GetValue<string>());
    }

    [Fact]
    public async Task Parses_two_multiline_messages_back_to_back()
    {
        var a = Frame("{\n  \"v\":1,\n  \"kind\":\"event\",\n  \"method\":\"runtime.health\",\n  \"event\":{\"ok\":true}\n}");
        var b = Frame("{\n  \"v\":1,\n  \"kind\":\"event\",\n  \"method\":\"agent.run.started\",\n  \"event\":{\"runId\":\"r1\"}\n}");
        var combined = new byte[a.Length + b.Length];
        a.CopyTo(combined, 0);
        b.CopyTo(combined, a.Length);

        var envelopes = await FramingCodec.DecodeAllAsync(combined);

        Assert.Equal(2, envelopes.Count);
        Assert.Equal("runtime.health", envelopes[0].Method);
        Assert.Equal("agent.run.started", envelopes[1].Method);
    }

    [Fact]
    public async Task Rejects_missing_content_length()
    {
        // Headers present but no Content-Length → not protocol-framed.
        var bytes = Encoding.UTF8.GetBytes("Content-Type: application/json\r\n\r\n{}");
        using var ms = new MemoryStream(bytes);
        var reader = new FrameReader(ms);

        await Assert.ThrowsAsync<ProtocolFramingException>(() => reader.ReadMessageAsync());
    }

    [Fact]
    public async Task Rejects_stdout_log_garbage()
    {
        // A stray log line on stdout (no header terminator before EOF) must be rejected,
        // not silently swallowed — this is the guardrail that keeps stdout protocol-only.
        var bytes = Encoding.UTF8.GetBytes("[info] runtime started and did some work\n");
        using var ms = new MemoryStream(bytes);
        var reader = new FrameReader(ms);

        // A single bare line with a trailing newline looks like a 0-header block to a lenient
        // reader; it has no Content-Length, so it must throw.
        await Assert.ThrowsAsync<ProtocolFramingException>(() => reader.ReadMessageAsync());
    }

    [Fact]
    public async Task Clean_eof_returns_null()
    {
        using var ms = new MemoryStream([]);
        var reader = new FrameReader(ms);

        Assert.Null(await reader.ReadMessageAsync());
    }

    [Fact]
    public async Task Accepts_bare_lf_separators()
    {
        var body = "{\"v\":1,\"kind\":\"response\",\"id\":\"x\",\"result\":{}}";
        var bytes = Encoding.UTF8.GetBytes($"Content-Length: {Encoding.UTF8.GetByteCount(body)}\n\n{body}");
        using var ms = new MemoryStream(bytes);
        var reader = new FrameReader(ms);

        var envelope = await reader.ReadEnvelopeAsync();
        Assert.NotNull(envelope);
        Assert.Equal("x", envelope!.Id);
    }

    [Fact]
    public async Task Rejects_truncated_body()
    {
        // Content-Length claims more bytes than are present.
        var bytes = Encoding.UTF8.GetBytes("Content-Length: 100\r\n\r\n{\"v\":1}");
        using var ms = new MemoryStream(bytes);
        var reader = new FrameReader(ms);

        await Assert.ThrowsAsync<ProtocolFramingException>(() => reader.ReadMessageAsync());
    }
}
