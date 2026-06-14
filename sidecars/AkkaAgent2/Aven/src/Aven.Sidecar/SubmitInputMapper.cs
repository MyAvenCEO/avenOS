using System.Text.Json.Nodes;
using Aven.Api.Requests;

namespace Aven.Sidecar;

/// <summary>
/// Builds an <see cref="ApiMessageRequest"/> from <c>messages.submit</c> params,
/// accepting two shapes:
/// <list type="bullet">
///   <item>the native HTTP request shape (idempotencyKey, incomingItemRef, …); and</item>
///   <item>the frontend's <c>AgentSubmitInput</c> (identityId, messageId, replyId, text,
///   sourceView, attachments) — mapped so the existing actor submission path is used.</item>
/// </list>
/// </summary>
public static class SubmitInputMapper
{
    public static ApiMessageRequest ToApiMessageRequest(JsonObject o)
    {
        var messageId = Str(o, "messageId");
        var idempotencyKey = Str(o, "idempotencyKey") ?? messageId;
        if (string.IsNullOrWhiteSpace(idempotencyKey))
        {
            throw SidecarError.InvalidParams("messages.submit requires 'idempotencyKey' or 'messageId'.");
        }

        var incomingItemRef = Str(o, "incomingItemRef") ?? messageId ?? idempotencyKey;

        // chat text lives under 'message' (native) or 'text' (frontend AgentSubmitInput).
        var contentSummary = Str(o, "contentSummary") ?? Str(o, "message") ?? Str(o, "text") ?? string.Empty;

        // Text chat is not one of the file input types (pdf/image/text infer from ref); default to "text".
        var inputType = Str(o, "inputType") ?? "text";

        var attachments = ResolveAttachmentRefs(o);
        var proposedIntent = Str(o, "proposedIntent") ?? string.Empty;
        var proposedReason = Str(o, "proposedReason") ?? Str(o, "sourceView") ?? string.Empty;
        var requiredSchemas = StrArray(o, "requiredSchemas");

        return new ApiMessageRequest(
            IdempotencyKey: idempotencyKey!,
            IncomingItemRef: incomingItemRef!,
            InputType: inputType,
            AttachmentRefs: attachments,
            ContentSummary: contentSummary,
            ProposedIntent: proposedIntent,
            ProposedReason: proposedReason,
            RequiredSchemas: requiredSchemas);
    }

    private static IReadOnlyList<string>? ResolveAttachmentRefs(JsonObject o)
    {
        // Native: attachmentRefs / artifactIds. Frontend: attachments[].fileId | .path.
        var explicitRefs = StrArray(o, "attachmentRefs") ?? StrArray(o, "artifactIds");
        if (explicitRefs is not null)
        {
            return explicitRefs;
        }

        if (o.TryGetPropertyValue("attachments", out var node) && node is JsonArray array)
        {
            var refs = new List<string>(array.Count);
            foreach (var item in array)
            {
                if (item is JsonObject att)
                {
                    var refValue = Str(att, "fileId") ?? Str(att, "path");
                    if (!string.IsNullOrWhiteSpace(refValue))
                    {
                        refs.Add(refValue!);
                    }
                }
            }

            return refs.Count > 0 ? refs : null;
        }

        return null;
    }

    private static string? Str(JsonObject o, string key) =>
        o.TryGetPropertyValue(key, out var node) && node is not null ? node.GetValue<string?>() : null;

    private static IReadOnlyList<string>? StrArray(JsonObject o, string key)
    {
        if (!o.TryGetPropertyValue(key, out var node) || node is not JsonArray array)
        {
            return null;
        }

        var list = new List<string>(array.Count);
        foreach (var item in array)
        {
            if (item is not null)
            {
                var s = item.GetValue<string?>();
                if (!string.IsNullOrWhiteSpace(s))
                {
                    list.Add(s!);
                }
            }
        }

        return list;
    }
}
