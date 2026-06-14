using Akka.Actor;

namespace Aven.Resources.Metadata;

public sealed class MetadataStoreClient : IMetadataStoreClient
{
    private readonly IActorRef _actor;
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(5);

    public MetadataStoreClient(
        ActorSystem system,
        string persistenceId,
        Func<SchemaRef, string, MetadataValidationResult> validator)
    {
        _actor = system.ActorOf(
            Props.Create(() => new MetadataStoreActor(persistenceId, validator)),
            persistenceId.Replace('/', '-'));
    }

    public MetadataCreateReply Create(MetadataCreateRequest request)
    {
        return _actor.Ask<MetadataCreateReply>(new MetadataCreateCommand(request), DefaultTimeout).GetAwaiter().GetResult();
    }

    public MetadataQueryResult Query(MetadataQuery query)
    {
        return _actor.Ask<MetadataQueryResult>(new MetadataQueryCommand(query), DefaultTimeout).GetAwaiter().GetResult();
    }

    public IReadOnlyList<MetadataRecord> InspectAll()
    {
        return _actor.Ask<IReadOnlyList<MetadataRecord>>(new MetadataInspectAll(), DefaultTimeout).GetAwaiter().GetResult();
    }
}