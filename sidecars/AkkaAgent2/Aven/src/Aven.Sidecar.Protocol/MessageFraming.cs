using System.Buffers;
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;

namespace Aven.Sidecar.Protocol;

/// <summary>
/// Thrown when an incoming byte stream cannot be parsed as a <c>Content-Length</c>
/// framed message (e.g. a stray stdout log line, a missing header, or a truncated body).
/// </summary>
public sealed class ProtocolFramingException(string message) : Exception(message);

/// <summary>
/// <c>Content-Length</c> framed JSON over a byte stream (MCP/LSP style, STDIO_RPC_SPEC.md §3.2):
///
/// <code>
/// Content-Length: &lt;bytes&gt;\r\n
/// \r\n
/// &lt;utf8 json body&gt;
/// </code>
///
/// Writing always emits canonical <c>\r\n</c> line endings. Reading is lenient and
/// also accepts bare <c>\n</c> separators. The body is exactly <c>Content-Length</c>
/// UTF-8 bytes, so JSON may contain newlines, embedded headers, or any text.
/// </summary>
public static class MessageFraming
{
    internal const string ContentLengthHeader = "Content-Length";
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: false);

    /// <summary>Frame a UTF-8 JSON body into header + body bytes.</summary>
    public static byte[] Encode(ReadOnlySpan<byte> jsonUtf8)
    {
        var header = Utf8.GetBytes($"{ContentLengthHeader}: {jsonUtf8.Length}\r\n\r\n");
        var buffer = new byte[header.Length + jsonUtf8.Length];
        header.CopyTo(buffer.AsSpan(0, header.Length));
        jsonUtf8.CopyTo(buffer.AsSpan(header.Length));
        return buffer;
    }

    /// <summary>Serialize and frame an envelope.</summary>
    public static byte[] Encode(ProtocolEnvelope envelope)
    {
        var json = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(envelope, ProtocolConstants.Json);
        return Encode(json);
    }

    /// <summary>Write a framed envelope to a stream and flush.</summary>
    public static async Task WriteAsync(Stream stream, ProtocolEnvelope envelope, CancellationToken cancellationToken = default)
    {
        var bytes = Encode(envelope);
        await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }
}

/// <summary>
/// Reads one framed message at a time from a stream. Headers are read a byte at a
/// time (they are tiny) so the reader never over-reads into the next message; the
/// body is then read in bulk as exactly <c>Content-Length</c> bytes. Multiple
/// messages back-to-back in one stream parse cleanly because each read consumes
/// precisely its own framing and no more.
/// </summary>
public sealed class FrameReader(Stream stream)
{
    private readonly Stream _stream = stream;
    private readonly byte[] _one = new byte[1];

    /// <summary>
    /// Read the next framed message body (UTF-8 JSON bytes), or <c>null</c> at a
    /// clean end of stream (no partial header pending).
    /// </summary>
    /// <exception cref="ProtocolFramingException">Malformed framing.</exception>
    public async Task<byte[]?> ReadMessageAsync(CancellationToken cancellationToken = default)
    {
        var header = await ReadHeaderBlockAsync(cancellationToken).ConfigureAwait(false);
        if (header is null)
        {
            return null;
        }

        var contentLength = ParseContentLength(header);
        var body = new byte[contentLength];
        await ReadExactlyAsync(body, cancellationToken).ConfigureAwait(false);
        return body;
    }

    /// <summary>Read the next framed message and deserialize it into an envelope.</summary>
    public async Task<ProtocolEnvelope?> ReadEnvelopeAsync(CancellationToken cancellationToken = default)
    {
        var body = await ReadMessageAsync(cancellationToken).ConfigureAwait(false);
        if (body is null)
        {
            return null;
        }

        try
        {
            var envelope = System.Text.Json.JsonSerializer.Deserialize<ProtocolEnvelope>(body, ProtocolConstants.Json);
            if (envelope is null)
            {
                throw new ProtocolFramingException("Message body deserialized to null.");
            }

            return envelope;
        }
        catch (System.Text.Json.JsonException ex)
        {
            throw new ProtocolFramingException($"Message body was not valid JSON: {ex.Message}");
        }
    }

    private async Task<string?> ReadHeaderBlockAsync(CancellationToken cancellationToken)
    {
        var bytes = new List<byte>(64);
        while (true)
        {
            var read = await _stream.ReadAsync(_one.AsMemory(0, 1), cancellationToken).ConfigureAwait(false);
            if (read == 0)
            {
                if (bytes.Count == 0)
                {
                    return null; // clean EOF on a message boundary
                }

                throw new ProtocolFramingException("Stream ended in the middle of a message header.");
            }

            bytes.Add(_one[0]);

            if (EndsWithHeaderTerminator(bytes))
            {
                return Encoding.ASCII.GetString(CollectionsMarshalAsSpan(bytes));
            }

            // Guard against an unbounded run of non-protocol bytes (e.g. log spam on stdout):
            // a real header block is small. 64 KiB without a terminator is garbage.
            if (bytes.Count > 64 * 1024)
            {
                throw new ProtocolFramingException("Header block exceeded 64 KiB without a terminator; stream is not protocol-framed.");
            }
        }
    }

    private static bool EndsWithHeaderTerminator(List<byte> bytes)
    {
        var n = bytes.Count;
        // \n\n (lenient)
        if (n >= 2 && bytes[n - 1] == (byte)'\n' && bytes[n - 2] == (byte)'\n')
        {
            return true;
        }

        // \r\n\r\n (canonical)
        return n >= 4
            && bytes[n - 1] == (byte)'\n' && bytes[n - 2] == (byte)'\r'
            && bytes[n - 3] == (byte)'\n' && bytes[n - 4] == (byte)'\r';
    }

    private static int ParseContentLength(string headerBlock)
    {
        var lines = headerBlock.Split('\n');
        foreach (var raw in lines)
        {
            var line = raw.Trim('\r', ' ', '\t');
            if (line.Length == 0)
            {
                continue;
            }

            var colon = line.IndexOf(':');
            if (colon <= 0)
            {
                continue;
            }

            var name = line[..colon].Trim();
            if (!name.Equals(MessageFraming.ContentLengthHeader, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var value = line[(colon + 1)..].Trim();
            if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var length) && length >= 0)
            {
                return length;
            }

            throw new ProtocolFramingException($"Invalid Content-Length value: '{value}'.");
        }

        throw new ProtocolFramingException("Missing required Content-Length header.");
    }

    private async Task ReadExactlyAsync(byte[] buffer, CancellationToken cancellationToken)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await _stream.ReadAsync(buffer.AsMemory(offset, buffer.Length - offset), cancellationToken).ConfigureAwait(false);
            if (read == 0)
            {
                throw new ProtocolFramingException($"Stream ended after {offset} of {buffer.Length} body bytes.");
            }

            offset += read;
        }
    }

    private static ReadOnlySpan<byte> CollectionsMarshalAsSpan(List<byte> list) =>
        System.Runtime.InteropServices.CollectionsMarshal.AsSpan(list);
}

/// <summary>Convenience helpers for tests and one-shot encode/decode.</summary>
public static class FramingCodec
{
    /// <summary>Decode all framed envelopes available in a byte buffer.</summary>
    public static async Task<IReadOnlyList<ProtocolEnvelope>> DecodeAllAsync(byte[] framed, CancellationToken cancellationToken = default)
    {
        using var ms = new MemoryStream(framed, writable: false);
        var reader = new FrameReader(ms);
        var list = new List<ProtocolEnvelope>();
        while (true)
        {
            var envelope = await reader.ReadEnvelopeAsync(cancellationToken).ConfigureAwait(false);
            if (envelope is null)
            {
                break;
            }

            list.Add(envelope);
        }

        return list;
    }

    /// <summary>Concatenate framed encodings of several envelopes (for back-to-back tests).</summary>
    public static byte[] EncodeAll(params ProtocolEnvelope[] envelopes)
    {
        var writer = new ArrayBufferWriter<byte>();
        foreach (var envelope in envelopes)
        {
            writer.Write(MessageFraming.Encode(envelope));
        }

        return writer.WrittenSpan.ToArray();
    }
}
