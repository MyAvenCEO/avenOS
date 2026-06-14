using Akka.Actor;

namespace Aven.Capabilities.Clients;

public sealed class CapabilityAdmissionClient : ICapabilityAdmissionClient
{
    private readonly IActorRef _actor;
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(5);

    public CapabilityAdmissionClient(IActorRef actor) => _actor = actor;

    public Task UpsertGrantAsync(CapabilityGrant grant) =>
        _actor.Ask<object>(new CapabilityUpsertGrantCommand(grant), DefaultTimeout);

    public Task<object> AdmitAsync(CapabilityAdmissionRequest request) =>
        _actor.Ask<object>(new CapabilityAdmitCommand(request), DefaultTimeout);

    public void UpsertGrant(CapabilityGrant grant) =>
        UpsertGrantAsync(grant).GetAwaiter().GetResult();

    public object Admit(CapabilityAdmissionRequest request) =>
        AdmitAsync(request).GetAwaiter().GetResult();
}
