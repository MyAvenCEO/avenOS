using Aven.Toolkit.Core.Identifiers;

namespace Aven.Toolkit.Artifacts.Tests;

public sealed class ArtifactRefTests
{
    [Fact]
    public void ArtifactRef_uses_artifact_identifiers()
    {
        var artifactRef = new ArtifactRef(new ArtifactId("artifact-1"), new ArtifactRevisionId("revision-1"));

        Assert.Equal("artifact-1", artifactRef.ArtifactId.Value);
        Assert.Equal("revision-1", artifactRef.RevisionId?.Value);
    }
}