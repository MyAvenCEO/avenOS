using Akka.Actor;

namespace Aven.WorkIntake.Clients;

public sealed class WorkIntakeClient
{
    private readonly IActorRef _actor;
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(5);

    public WorkIntakeClient(IActorRef actor) => _actor = actor;

    public WorkIntakeState State =>
        _actor.Ask<WorkIntakeState>(new InspectWorkIntake(), DefaultTimeout).GetAwaiter().GetResult();

    public Task<WorkIntakeState> GetStateAsync(CancellationToken cancellationToken = default) =>
        _actor.Ask<WorkIntakeState>(new InspectWorkIntake(), DefaultTimeout, cancellationToken);

    public object Evaluate(WorkOffer offer) =>
        EvaluateAsync(offer).GetAwaiter().GetResult();

    public Task<object> EvaluateAsync(WorkOffer offer, CancellationToken cancellationToken = default) =>
        _actor.Ask<object>(new EvaluateWorkOfferCommand(offer), DefaultTimeout, cancellationToken);

    public object Commit(WorkClaimCommit commit) =>
        CommitAsync(commit).GetAwaiter().GetResult();

    public Task<object> CommitAsync(WorkClaimCommit commit, CancellationToken cancellationToken = default) =>
        _actor.Ask<object>(new WorkClaimCommitCommand(commit), DefaultTimeout, cancellationToken);
}
