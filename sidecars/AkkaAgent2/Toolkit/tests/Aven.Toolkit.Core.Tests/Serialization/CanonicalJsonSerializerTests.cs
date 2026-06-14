using System.Text.Json;
using System.Text;
using System.Reflection;
using Aven.Toolkit.Core.Serialization;

namespace Aven.Toolkit.Core.Tests.Serialization;

public sealed class CanonicalJsonSerializerTests
{
    private static readonly CanonicalJsonSerializer Serializer = new();

    private sealed record SetEnvelope(IReadOnlySet<int> Values);
    private sealed record ElementEnvelope(JsonElement Payload);

    [Fact]
    public void CanonicalJson_rejects_duplicate_object_properties()
    {
        Assert.Throws<JsonException>(() => Serializer.Canonicalize("""
            {"a":1,"nested":{"b":2,"b":3}}
            """));
    }

    [Fact]
    public void CanonicalJson_hashes_semantically_equal_json_equally()
    {
        var left = """
            {"b":2.0,"a":1,"nested":{"z":true,"m":[3,2,1],"s":"line\ntext"}}
            """;
        var right = """
            {
              "nested": { "s": "line\ntext", "m": [3.0, 2.00, 1e0], "z": true },
              "a": 1.0,
              "b": 2
            }
            """;

        Assert.Equal(Serializer.HashJson(left), Serializer.HashJson(right));
    }

    [Fact]
    public void CanonicalJson_hashes_semantically_different_json_differently()
    {
        var left = Serializer.HashJson("""{"a":1,"b":2}""");
        var right = Serializer.HashJson("""{"a":1,"b":3}""");

        Assert.NotEqual(left, right);
    }

    [Fact]
    public void PayloadHash_IsStableForSemanticallyEquivalentCanonicalJson()
    {
        var left = JsonDocument.Parse("""
            {"b":2,"a":1,"nested":{"z":true,"m":[3,2,1]}}
            """).RootElement;

        var right = JsonDocument.Parse("""
            {"nested":{"m":[3,2,1],"z":true},"a":1,"b":2}
            """).RootElement;

        Assert.Equal(Serializer.Hash(left), Serializer.Hash(right));
    }

    [Fact]
    public void CanonicalJson_sorts_properties_but_preserves_array_order()
    {
        var canonical = Serializer.Canonicalize("""{"z":true,"a":[3,1,2],"b":{"y":2,"x":1}}""");

        Assert.Equal("{\"a\":[3,1,2],\"b\":{\"x\":1,\"y\":2},\"z\":true}", canonical);
    }

    [Fact]
    public void CanonicalJson_preserves_string_escaping_booleans_and_nulls()
    {
        var canonical = Serializer.Canonicalize("""{"text":"line\n\t\"quoted\"","flag":true,"missing":null}""");
        var escapedQuote = "\\u" + "0022";
        var expected = $"{{\"flag\":true,\"missing\":null,\"text\":\"line\\n\\t{escapedQuote}quoted{escapedQuote}\"}}";

        Assert.Equal(expected, canonical);
    }

    [Theory]
    [InlineData("1.0", "1")]
    [InlineData("1.50", "1.5")]
    [InlineData("1e3", "1000")]
    [InlineData("-0", "0")]
    [InlineData("0.0", "0")]
    [InlineData("0e0", "0")]
    public void CanonicalJson_canonicalizes_numbers(string number, string expected)
    {
        var canonical = Serializer.Canonicalize($"{{\"n\":{number}}}");

        Assert.Equal($"{{\"n\":{expected}}}", canonical);
    }

    [Fact]
    public void CanonicalJson_rejects_duplicate_top_level_properties()
    {
        Assert.Throws<JsonException>(() => Serializer.Canonicalize("""{"a":1,"a":2}"""));
    }

    [Fact]
    public void CanonicalJson_rejects_non_finite_numbers_that_cannot_be_canonicalized()
    {
        Assert.Throws<JsonException>(() => Serializer.Canonicalize("""{"n":1e5000}"""));
    }

    [Fact]
    public void CanonicalJson_canonicalizes_large_exponent_numbers_via_finite_double_fallback()
    {
        var canonical = Serializer.Canonicalize("""{"n":1e40}""");

        Assert.Equal("{\"n\":1E+40}", canonical);
    }

    [Fact]
    public void CanonicalJson_canonicalizes_underflowing_double_numbers_to_zero()
    {
        var canonical = Serializer.Canonicalize("""{"n":1e-325}""");

        Assert.Equal("{\"n\":0}", canonical);
    }

    [Fact]
    public void Hash_rejects_duplicate_properties_inside_json_element_payloads()
    {
        using var document = JsonDocument.Parse("""{"payload":{"a":1,"a":2}}""");

        Assert.Throws<JsonException>(() => Serializer.Hash(new ElementEnvelope(document.RootElement.GetProperty("payload"))));
    }

    [Fact]
    public void WriteCanonical_rejects_undefined_json_element_values()
    {
        var method = typeof(CanonicalJsonSerializer).GetMethod("WriteCanonical", BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(method);

        var exception = Assert.Throws<TargetInvocationException>(() => method!.Invoke(null, [default(JsonElement), new StringBuilder()]));
        Assert.IsType<NotSupportedException>(exception.InnerException);
    }

    [Fact]
    public void Serialize_orders_read_only_sets_canonically()
    {
        var value = new SetEnvelope(new HashSet<int> { 3, 1, 2 });

        var json = Serializer.Serialize(value);

        Assert.Equal("{\"values\":[1,2,3]}", json);
    }

    [Fact]
    public void DefaultOptions_deserializes_read_only_sets()
    {
        var value = JsonSerializer.Deserialize<SetEnvelope>("""{"values":[3,1,2,2]}""", CanonicalJsonSerializer.DefaultOptions);

        Assert.NotNull(value);
        Assert.Equal([1, 2, 3], value!.Values.OrderBy(static x => x).ToArray());
    }
}