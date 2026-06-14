namespace Aven.Toolkit.Capabilities.Tests;

public sealed class CapabilityConstraintsTests
{
    [Fact]
    public void CapabilityConstraints_PreservesPortableMetadata()
    {
        var constraints = new CapabilityConstraints(MaxUses: 5, BudgetLimit: 12.5m, Metadata: new Dictionary<string, string>
        {
            ["allowedSchemas"] = "schema://invoice@1"
        });

        Assert.Equal(5, constraints.MaxUses);
        Assert.Equal(12.5m, constraints.BudgetLimit);
        Assert.Equal("schema://invoice@1", constraints.Metadata!["allowedSchemas"]);
    }

    [Fact]
    public void Identical_constraints_are_equal()
    {
        var left = CreateConstraints(maxUses: 3, budgetLimit: 9.5m, metadata: new Dictionary<string, string>
        {
            ["allowedMimeTypes"] = "application/pdf"
        });
        var right = CreateConstraints(maxUses: 3, budgetLimit: 9.5m, metadata: new Dictionary<string, string>
        {
            ["allowedMimeTypes"] = "application/pdf"
        });

        Assert.Equal(left, right);
        Assert.True(left == right);
    }

    [Fact]
    public void Same_metadata_with_different_insertion_order_is_equal()
    {
        var left = CreateConstraints(metadata: new Dictionary<string, string>
        {
            ["a"] = "1",
            ["b"] = "2"
        });
        var right = CreateConstraints(metadata: new Dictionary<string, string>
        {
            ["b"] = "2",
            ["a"] = "1"
        });

        Assert.Equal(left, right);
    }

    [Fact]
    public void Same_metadata_reference_on_distinct_constraints_is_equal()
    {
        var metadata = new Dictionary<string, string>
        {
            ["a"] = "1"
        };

        var left = CreateConstraints(metadata: metadata);
        var right = CreateConstraints(metadata: metadata);

        Assert.Equal(left, right);
    }

    [Fact]
    public void Different_MaxUses_is_not_equal()
    {
        var left = CreateConstraints(maxUses: 1);
        var right = CreateConstraints(maxUses: 2);

        Assert.NotEqual(left, right);
    }

    [Fact]
    public void Different_BudgetLimit_is_not_equal()
    {
        var left = CreateConstraints(budgetLimit: 10m);
        var right = CreateConstraints(budgetLimit: 11m);

        Assert.NotEqual(left, right);
    }

    [Fact]
    public void Null_metadata_and_empty_metadata_are_not_equal()
    {
        var left = CreateConstraints(metadata: null);
        var right = CreateConstraints(metadata: new Dictionary<string, string>());

        Assert.NotEqual(left, right);
    }

    [Fact]
    public void Missing_metadata_key_is_not_equal()
    {
        var left = CreateConstraints(metadata: new Dictionary<string, string>
        {
            ["a"] = "1"
        });
        var right = CreateConstraints(metadata: new Dictionary<string, string>
        {
            ["a"] = "1",
            ["b"] = "2"
        });

        Assert.NotEqual(left, right);
    }

    [Fact]
    public void Same_metadata_key_with_different_value_is_not_equal()
    {
        var left = CreateConstraints(metadata: new Dictionary<string, string>
        {
            ["a"] = "1"
        });
        var right = CreateConstraints(metadata: new Dictionary<string, string>
        {
            ["a"] = "2"
        });

        Assert.NotEqual(left, right);
    }

    [Fact]
    public void GetHashCode_is_stable_for_equal_metadata_in_different_order()
    {
        var left = CreateConstraints(maxUses: 3, budgetLimit: 9.5m, metadata: new Dictionary<string, string>
        {
            ["a"] = "1",
            ["b"] = "2"
        });
        var right = CreateConstraints(maxUses: 3, budgetLimit: 9.5m, metadata: new Dictionary<string, string>
        {
            ["b"] = "2",
            ["a"] = "1"
        });

        Assert.Equal(left.GetHashCode(), right.GetHashCode());
    }

    [Fact]
    public void GetHashCode_changes_for_materially_different_constraints()
    {
        var left = CreateConstraints(maxUses: 3, budgetLimit: 9.5m, metadata: new Dictionary<string, string>
        {
            ["a"] = "1"
        });
        var right = CreateConstraints(maxUses: 4, budgetLimit: 9.5m, metadata: new Dictionary<string, string>
        {
            ["a"] = "1"
        });

        Assert.NotEqual(left.GetHashCode(), right.GetHashCode());
    }

    [Fact]
    public void Equality_with_null_returns_false()
    {
        var constraints = CreateConstraints();

        Assert.False(constraints.Equals(null));
    }

    [Fact]
    public void Equality_with_same_reference_returns_true()
    {
        var constraints = CreateConstraints();

        Assert.True(constraints.Equals(constraints));
    }

    [Fact]
    public void CapabilityConstraints_allows_null_optional_fields()
    {
        var constraints = new CapabilityConstraints();

        Assert.Null(constraints.MaxUses);
        Assert.Null(constraints.BudgetLimit);
        Assert.Null(constraints.Metadata);
    }

    private static CapabilityConstraints CreateConstraints(
        int? maxUses = null,
        decimal? budgetLimit = null,
        IReadOnlyDictionary<string, string>? metadata = null)
        => new(maxUses, budgetLimit, metadata);
}
