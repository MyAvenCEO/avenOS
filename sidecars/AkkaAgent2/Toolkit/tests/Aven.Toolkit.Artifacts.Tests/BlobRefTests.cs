namespace Aven.Toolkit.Artifacts.Tests;

public sealed class BlobRefTests
{
    [Fact]
    public void BlobRef_is_distinct_from_artifact_ref_string_representation()
    {
        var artifactRef = new ArtifactRef(new("artifact-1"), new("revision-1"));
        var blobRef = new BlobRef("sha256", new string('b', 64), 12);

        Assert.NotEqual(artifactRef.ToString(), blobRef.ToString());
        Assert.IsType<ArtifactRef>(artifactRef);
        Assert.IsType<BlobRef>(blobRef);
    }
}