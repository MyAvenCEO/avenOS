using System.Security.Cryptography;
using System.Text;
using Aven.Toolkit.Core.Serialization;

namespace Aven.WorkIntake.Runtime.Hashing;

internal static class WorkOfferHasher
{
    private static readonly CanonicalJsonSerializer CanonicalJsonSerializer = new();

    public static string ComputeHash(WorkOffer offer) =>
        CanonicalJsonSerializer.Hash(new
        {
            RoutingAttemptId = offer.RoutingAttemptId.Value,
            OfferId = offer.OfferId.Value,
            CandidateRoleAgentId = offer.CandidateRoleAgentId.Value,
            offer.IncomingItemRef,
            offer.InputType,
            AttachmentRefs = offer.AttachmentRefs.ToArray(),
            offer.ContentSummary,
            offer.ProposedIntent,
            offer.ProposedReason,
            RequiredSchemas = offer.RequiredSchemas.Select(static x => x.Value).ToArray(),
            CorrelationId = offer.CorrelationId.Value,
            ReplyTo = new { offer.ReplyTo.Value, offer.ReplyTo.Protocol }
        });

    public static string ComputeHashText(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}
