using System.Text.Json;

namespace Aven.RoleAgents.Runtime;

internal sealed class RoleAgentWorkInputFactory
{
    private readonly RoleAgentId _agentId;
    private readonly RoleDescriptor _roleProfile;

    public RoleAgentWorkInputFactory(RoleAgentId agentId, RoleDescriptor roleProfile)
    {
        _agentId = agentId;
        _roleProfile = roleProfile;
    }

    public AcceptedRoleWorkInput? TryCreateFromCommittedOffer(DeliveryAttemptOffer offer, out OperationError? rejection)
    {
        CommittedWorkItem committedInput;
        try
        {
            committedInput = JsonSerializer.Deserialize<CommittedWorkItem>(offer.Envelope.Payload)
                ?? throw new InvalidOperationException("CommittedWorkItem payload was empty.");
        }
        catch (Exception ex)
        {
            rejection = new OperationError("invalid_agent_committed_input", ex.Message, false);
            return null;
        }

        if (committedInput.RoleAgentId != _agentId)
        {
            rejection = new OperationError(
                "agent_id_mismatch",
                $"Committed input targeted agent '{committedInput.RoleAgentId.Value}' but actor is '{_agentId.Value}'.",
                false);
            return null;
        }

        if (!BuiltInRoleBehaviorCatalog.TryResolveAcceptedInputCommand(_roleProfile.RoleName, committedInput.CommandType, out var normalizedCommandType))
        {
            rejection = new OperationError(
                "unsupported_committed_input_command",
                $"Committed input command type '{committedInput.CommandType}' is not supported by role '{_roleProfile.RoleName}'.",
                false);
            return null;
        }

        var resolved = new OperationResolved(
            new OperationKey(offer.Envelope.Sender, new RequestId(committedInput.ClaimId.Value), normalizedCommandType),
            committedInput.CorrelationId,
            offer.Envelope.Sender,
            offer.Envelope.Sender,
            new OperationValue(normalizedCommandType, committedInput.CommandJson));

        rejection = null;
        return new AcceptedRoleWorkInput(
            CreateWorkItemId(committedInput.ClaimId.Value),
            BuildSubject(committedInput.ContentSummary, committedInput.ProposedIntent, normalizedCommandType),
            committedInput.ContentSummary,
            ToArtifactRef(committedInput.SourceItemRef),
            BuildGoal(normalizedCommandType, committedInput.ContentSummary, committedInput.ProposedIntent),
            resolved,
            committedInput.CorrelationId);
    }

    public AcceptedRoleWorkInput? TryCreateFromScheduledOffer(DeliveryAttemptOffer offer, out OperationError? rejection)
    {
        ScheduledWorkTriggered triggered;
        try
        {
            triggered = JsonSerializer.Deserialize<ScheduledWorkTriggered>(offer.Envelope.Payload)
                ?? throw new InvalidOperationException("ScheduledWorkTriggered payload was empty.");
        }
        catch (Exception ex)
        {
            rejection = new OperationError("invalid_scheduled_input_payload", ex.Message, false);
            return null;
        }

        if (!BuiltInRoleBehaviorCatalog.TryResolveAcceptedInputCommand(_roleProfile.RoleName, triggered.CommandType, out var normalizedCommandType))
        {
            rejection = new OperationError(
                "unsupported_scheduled_input_command",
                $"Scheduled input command type '{triggered.CommandType}' is not supported by role '{_roleProfile.RoleName}'.",
                false);
            return null;
        }

        var resolved = new OperationResolved(
            new OperationKey(offer.Envelope.Sender, new RequestId(triggered.OccurrenceId), normalizedCommandType),
            offer.Envelope.CorrelationId,
            offer.Envelope.Sender,
            offer.Envelope.Sender,
            new OperationValue(normalizedCommandType, triggered.CommandJson));

        rejection = null;
        return new AcceptedRoleWorkInput(
            CreateWorkItemId(triggered.OccurrenceId),
            $"scheduled {normalizedCommandType}",
            $"schedule:{triggered.ScheduleId}",
            null,
            BuildGoal(normalizedCommandType, $"schedule:{triggered.ScheduleId}", null),
            resolved,
            offer.Envelope.CorrelationId);
    }

    private static WorkItemId CreateWorkItemId(string seed) => new($"work-{SanitizeSeed(seed)}");

    private static string BuildSubject(string? contentSummary, string? proposedIntent, string commandType) =>
        !string.IsNullOrWhiteSpace(contentSummary)
            ? contentSummary
            : !string.IsNullOrWhiteSpace(proposedIntent)
                ? proposedIntent!
                : commandType;

    private static string BuildGoal(string commandType, string? contentSummary, string? proposedIntent) =>
        $"Handle {BuildSubject(contentSummary, proposedIntent, commandType)}";

    private static ArtifactRef? ToArtifactRef(string? sourceItemRef) =>
        string.IsNullOrWhiteSpace(sourceItemRef)
            ? null
            : new ArtifactRef(new ArtifactId(sourceItemRef));

    private static string SanitizeSeed(string value)
    {
        Span<char> buffer = stackalloc char[value.Length];
        var index = 0;
        foreach (var ch in value)
        {
            buffer[index++] = char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '-';
        }

        return new string(buffer[..index]);
    }
}