namespace Aven.WorkIntake.Contracts.State;

public sealed record WorkIntakeState(
    RoleAgentId RoleAgentId,
    IReadOnlyDictionary<WorkOfferId, WorkOfferState> Offers,
    IReadOnlyDictionary<WorkClaimId, WorkOfferId> Claims)
{
    public static WorkIntakeState Empty(RoleAgentId agentId) =>
        new(
            agentId,
            new Dictionary<WorkOfferId, WorkOfferState>(),
            new Dictionary<WorkClaimId, WorkOfferId>());
}
