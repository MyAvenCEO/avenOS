using Aven.Toolkit.Core.Serialization;

namespace Aven.Tests.ActorKernel;

public class Phase02SerializationTests
{
    [Fact]
    public void CanonicalSerializationSortsObjectProperties()
    {
        var serializer = new CanonicalJsonSerializer();

        var json = serializer.Serialize(new { Z = 1, A = 2, M = new { B = 3, A = 4 } });

        Assert.Equal("{\"a\":2,\"m\":{\"a\":4,\"b\":3},\"z\":1}", json);
    }
}