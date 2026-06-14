namespace Aven.Resources.Metadata;

public interface IMetadataStoreClient
{
    MetadataCreateReply Create(MetadataCreateRequest request);
    MetadataQueryResult Query(MetadataQuery query);
    IReadOnlyList<MetadataRecord> InspectAll();
}