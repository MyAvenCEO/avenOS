namespace Aven.Capabilities.Clients;

public sealed class InMemoryCapabilityAdmissionClient : ICapabilityAdmissionClient
{
    private readonly Dictionary<CapabilityId, CapabilityGrant> _grants = new();
    private readonly Dictionary<CapabilityId, HashSet<OperationKey>> _consumedOperationKeys = new();

    public Task UpsertGrantAsync(CapabilityGrant grant)
    {
        UpsertGrant(grant);
        return Task.CompletedTask;
    }

    public Task<object> AdmitAsync(CapabilityAdmissionRequest request) =>
        Task.FromResult(Admit(request));

    public void UpsertGrant(CapabilityGrant grant)
    {
        _grants[grant.Id] = grant;
        if (!_consumedOperationKeys.ContainsKey(grant.Id))
        {
            _consumedOperationKeys[grant.Id] = new HashSet<OperationKey>();
        }
    }

    public object Admit(CapabilityAdmissionRequest request)
    {
        if (!_grants.TryGetValue(request.CapabilityId, out var grant))
        {
            return Reject(request, "capability_missing", "Capability grant was not found.");
        }

        if (grant.RevokedAt is not null && grant.RevokedAt <= request.RequestedAt)
        {
            return Reject(request, "capability_revoked", "Capability has been revoked.");
        }

        if (grant.Holder != request.OperationKey.Caller)
        {
            return Reject(request, "capability_wrong_holder", "Capability holder does not match the operation caller.");
        }

        if (grant.Target != request.Target)
        {
            return Reject(request, "capability_wrong_target", "Capability target does not match the requested target.");
        }

        if (!grant.AllowedMessageTypes.Contains(request.MessageType, StringComparer.Ordinal))
        {
            return Reject(request, "capability_message_not_allowed", "Capability does not allow this message type.");
        }

        if (grant.ExpiresAt is not null && grant.ExpiresAt <= request.RequestedAt)
        {
            return Reject(request, "capability_expired", "Capability has expired.");
        }

        if (!DelegationIsValid(grant, _grants, out var delegationErrorCode, out var delegationErrorMessage))
        {
            return Reject(request, delegationErrorCode, delegationErrorMessage);
        }

        if (!CaveatsAreSatisfied(grant, request, out var caveatErrorCode, out var caveatErrorMessage))
        {
            return Reject(request, caveatErrorCode, caveatErrorMessage);
        }

        var consumed = _consumedOperationKeys[grant.Id];
        if (consumed.Contains(request.OperationKey))
        {
            return new CapabilityAdmitted(grant.Id, request.OperationKey, consumed.Count);
        }

        if (grant.Constraints.MaxUses is int maxUses && consumed.Count >= maxUses)
        {
            return Reject(request, "capability_max_uses_exceeded", "Capability max uses exceeded.");
        }

        consumed.Add(request.OperationKey);
        return new CapabilityAdmitted(grant.Id, request.OperationKey, consumed.Count);
    }

    private static CapabilityRejected Reject(CapabilityAdmissionRequest request, string code, string message) =>
        new(request.CapabilityId, request.OperationKey, new OperationError(code, message, false));

    private static bool DelegationIsValid(
        CapabilityGrant grant,
        IReadOnlyDictionary<CapabilityId, CapabilityGrant> grants,
        out string code,
        out string message)
    {
        code = string.Empty;
        message = string.Empty;

        if (grant.ParentCapabilityId is not { } parentId)
        {
            return true;
        }

        if (!grants.TryGetValue(parentId, out var parent))
        {
            code = "capability_delegation_parent_missing";
            message = "Delegated capability parent grant was not found.";
            return false;
        }

        if (!parent.CanDelegate)
        {
            code = "capability_delegation_not_allowed";
            message = "Parent capability does not allow delegation.";
            return false;
        }

        if (grant.Target != parent.Target)
        {
            code = "capability_delegation_broadens_target";
            message = "Delegated capability cannot change target.";
            return false;
        }

        if (grant.AllowedMessageTypes.Except(parent.AllowedMessageTypes, StringComparer.Ordinal).Any())
        {
            code = "capability_delegation_broadens_actions";
            message = "Delegated capability cannot add message types.";
            return false;
        }

        if (parent.ExpiresAt is not null && (grant.ExpiresAt is null || grant.ExpiresAt > parent.ExpiresAt))
        {
            code = "capability_delegation_broadens_expiry";
            message = "Delegated capability cannot outlive parent capability.";
            return false;
        }

        if (parent.Constraints.MaxUses is int parentMaxUses &&
            (grant.Constraints.MaxUses is not int childMaxUses || childMaxUses > parentMaxUses))
        {
            code = "capability_delegation_broadens_max_uses";
            message = "Delegated capability cannot exceed parent max uses.";
            return false;
        }

        return true;
    }

    private static bool CaveatsAreSatisfied(CapabilityGrant grant, CapabilityAdmissionRequest request, out string code, out string message)
    {
        code = string.Empty;
        message = string.Empty;
        var caveats = grant.Constraints.Metadata;
        if (caveats is null || caveats.Count == 0)
        {
            return true;
        }

        var attributes = request.ResourceAttributes ?? new Dictionary<string, string>();

        if (!AllowedListContains(caveats, "allowedSchemas", attributes, "schema"))
        {
            code = "capability_schema_not_allowed";
            message = "Capability caveat does not allow this schema.";
            return false;
        }

        if (!AllowedListContains(caveats, "allowedSubjectTypes", attributes, "subjectType"))
        {
            code = "capability_subject_type_not_allowed";
            message = "Capability caveat does not allow this subject type.";
            return false;
        }

        if (!AllowedListContains(caveats, "allowedMimeTypes", attributes, "mimeType"))
        {
            code = "capability_mime_type_not_allowed";
            message = "Capability caveat does not allow this MIME type.";
            return false;
        }

        if (caveats.TryGetValue("requireEvidenceHandles", out var requireEvidence) &&
            bool.TryParse(requireEvidence, out var evidenceRequired) && evidenceRequired &&
            (!attributes.TryGetValue("evidenceHandles", out var evidenceHandles) || string.IsNullOrWhiteSpace(evidenceHandles)))
        {
            code = "capability_evidence_handles_required";
            message = "Capability requires evidence handles.";
            return false;
        }

        if (caveats.TryGetValue("allowSupersession", out var allowSupersession) &&
            bool.TryParse(allowSupersession, out var supersessionAllowed) && !supersessionAllowed &&
            attributes.TryGetValue("supersedesRecordId", out var supersedesRecordId) &&
            !string.IsNullOrWhiteSpace(supersedesRecordId))
        {
            code = "capability_supersession_not_allowed";
            message = "Capability does not allow supersession.";
            return false;
        }

        if (caveats.TryGetValue("maxBytes", out var maxBytesText) &&
            long.TryParse(maxBytesText, out var maxBytes) &&
            attributes.TryGetValue("bytes", out var bytesText) &&
            long.TryParse(bytesText, out var bytes) &&
            bytes > maxBytes)
        {
            code = "capability_max_bytes_exceeded";
            message = "Capability max bytes caveat exceeded.";
            return false;
        }

        return true;
    }

    private static bool AllowedListContains(
        IReadOnlyDictionary<string, string> caveats,
        string caveatKey,
        IReadOnlyDictionary<string, string> attributes,
        string attributeKey)
    {
        if (!caveats.TryGetValue(caveatKey, out var allowedText))
        {
            return true;
        }

        if (!attributes.TryGetValue(attributeKey, out var actual) || string.IsNullOrWhiteSpace(actual))
        {
            return false;
        }

        return allowedText
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Contains(actual, StringComparer.Ordinal);
    }
}