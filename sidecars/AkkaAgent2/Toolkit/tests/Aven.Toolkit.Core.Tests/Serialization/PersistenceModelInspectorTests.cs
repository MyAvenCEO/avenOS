using Aven.Toolkit.Core.Serialization;

namespace Aven.Toolkit.Core.Tests.Serialization;

public sealed class PersistenceModelInspectorTests
{
    private sealed class RootModel
    {
        public AllowedChild Allowed { get; init; } = new();
    }

    private sealed class AllowedChild
    {
        public ForbiddenChild Forbidden { get; init; } = new();
        public string Name { get; init; } = string.Empty;
    }

    private sealed class ForbiddenChild
    {
        public int Count { get; init; }
    }

    private sealed class RecursiveNode
    {
        public RecursiveNode? Next { get; init; }
        public string Id { get; init; } = string.Empty;
    }

    [Fact]
    public void Inspector_finds_nested_forbidden_type_paths()
    {
        var paths = PersistenceModelInspector.FindForbiddenTypePaths<RootModel>(type => type == typeof(ForbiddenChild));

        Assert.Equal(["RootModel.Allowed.Forbidden"], paths);
    }

    [Fact]
    public void Inspector_type_overload_returns_empty_for_allowed_models()
    {
        var paths = PersistenceModelInspector.FindForbiddenTypePaths(typeof(AllowedChild), type => type == typeof(ForbiddenChild));

        Assert.Equal(["AllowedChild.Forbidden"], paths);
    }

    [Fact]
    public void Inspector_ignores_primitives_and_handles_recursive_models()
    {
        var paths = PersistenceModelInspector.FindForbiddenTypePaths(typeof(RecursiveNode), type => type == typeof(DateTime));

        Assert.Empty(paths);
    }
}