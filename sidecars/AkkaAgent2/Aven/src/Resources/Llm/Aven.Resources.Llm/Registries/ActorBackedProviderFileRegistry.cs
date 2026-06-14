using Akka.Actor;

namespace Aven.Resources.Llm.Registries;

public sealed class ActorBackedProviderFileRegistry : IProviderFileRegistry
{
    private readonly IActorRef _actor;
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(180);

    public ActorBackedProviderFileRegistry(ActorSystem system, string persistenceId)
    {
        _actor = system.ActorOf(
            Props.Create(() => new ProviderFileRegistryActor(persistenceId)),
            persistenceId.Replace('/', '-'));
    }

    public ActorBackedProviderFileRegistry(ActorSystem system, string persistenceId, IProviderFileUploader uploader)
    {
        _actor = system.ActorOf(
            Props.Create(() => new ProviderFileRegistryActor(persistenceId, uploader)),
            persistenceId.Replace('/', '-'));
    }

    public Task<ProviderFileDescriptor> GetOrCreateAsync(string providerName, ArtifactSourceDescriptor artifact, string purpose, string transportMode, CancellationToken cancellationToken = default) =>
        _actor.Ask<ProviderFileDescriptor>(new ProviderFileGetOrCreateCommand(providerName, artifact, purpose, transportMode), DefaultTimeout, cancellationToken);

    public ProviderFileDescriptor GetOrCreate(string providerName, ArtifactSourceDescriptor artifact, string purpose, string transportMode) =>
        GetOrCreateAsync(providerName, artifact, purpose, transportMode).Result;
}
