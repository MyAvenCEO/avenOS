using Aven.Toolkit.Core.Schema;

namespace Aven.Toolkit.Core.Tests.Schema;

public sealed class SimpleJsonSchemaValidatorTests
{
    private static readonly SimpleJsonSchemaValidator Validator = new();

    [Fact]
    public void SimpleJsonSchemaValidator_accepts_matching_object_shape()
    {
        var schema = """
            {
              "type": "object",
              "required": ["invoiceNumber", "dueDate"],
              "additionalProperties": false,
              "properties": {
                "invoiceNumber": { "type": "string", "minLength": 3 },
                "dueDate": { "type": "string", "format": "date" },
                "grossAmount": { "type": "number", "minimum": 0 }
              }
            }
            """;

        var instance = """
            {
              "invoiceNumber": "INV-100",
              "dueDate": "2026-06-10",
              "grossAmount": 42.50
            }
            """;

        Assert.Empty(Validator.Validate(schema, instance));
    }

    [Fact]
    public void SimpleJsonSchemaValidator_reports_required_additional_and_format_errors()
    {
        var schema = """
            {
              "type": "object",
              "required": ["invoiceNumber", "dueDate"],
              "additionalProperties": false,
              "properties": {
                "invoiceNumber": { "type": "string", "minLength": 3 },
                "dueDate": { "type": "string", "format": "date" }
              }
            }
            """;

        var instance = """
            {
              "invoiceNumber": "AB",
              "dueDate": "10-06-2026",
              "unexpected": true
            }
            """;

        var errors = Validator.Validate(schema, instance);

        Assert.Contains(errors, static error => error.Contains("$.invoiceNumber: string is shorter than the minimum length.", StringComparison.Ordinal));
        Assert.Contains(errors, static error => error.Contains("$.dueDate: string does not match required format 'date'.", StringComparison.Ordinal));
        Assert.Contains(errors, static error => error.Contains("$: additional property 'unexpected' is not allowed.", StringComparison.Ordinal));
    }

    [Fact]
    public void SimpleJsonSchemaValidator_reports_enum_const_and_array_constraints()
    {
        var schema = """
            {
              "type": "array",
              "minItems": 2,
              "items": {
                "type": "object",
                "required": ["kind", "status"],
                "properties": {
                  "kind": { "const": "invoice" },
                  "status": { "enum": ["new", "paid"] }
                }
              }
            }
            """;

        var instance = """
            [
              { "kind": "invoice", "status": "new" },
              { "kind": "statement", "status": "archived" }
            ]
            """;

        var errors = Validator.Validate(schema, instance);

        Assert.Contains(errors, static error => error.Contains("$[1].kind: value does not match required const value.", StringComparison.Ordinal));
        Assert.Contains(errors, static error => error.Contains("$[1].status: value is not one of the allowed enum members.", StringComparison.Ordinal));
    }

    [Fact]
    public void SimpleJsonSchemaValidator_reports_type_mismatch_and_missing_required_property()
    {
        var schema = """
            {
              "type": "object",
              "required": ["name"],
              "properties": {
                "name": { "type": "string" },
                "age": { "type": "integer" }
              }
            }
            """;

        var errors = Validator.Validate(schema, """{"age":"old"}""");

        Assert.Contains(errors, static error => error.Contains("$: missing required property 'name'.", StringComparison.Ordinal));
        Assert.Contains(errors, static error => error.Contains("$.age: expected type '\"integer\"' but found 'String'.", StringComparison.Ordinal));
    }

    [Fact]
    public void SimpleJsonSchemaValidator_reports_pattern_and_max_length_errors()
    {
        var schema = """
            {
              "type": "object",
              "properties": {
                "code": { "type": "string", "pattern": "^[A-Z]+$", "maxLength": 3 }
              }
            }
            """;

        var errors = Validator.Validate(schema, """{"code":"abcd"}""");

        Assert.Contains(errors, static error => error.Contains("$.code: string value does not match required pattern '^[A-Z]+$'.", StringComparison.Ordinal));
        Assert.Contains(errors, static error => error.Contains("$.code: string is longer than the maximum length.", StringComparison.Ordinal));
    }

    [Fact]
    public void SimpleJsonSchemaValidator_reports_minimum_and_maximum_errors()
    {
        var schema = """
            {
              "type": "object",
              "properties": {
                "min": { "type": "number", "minimum": 10 },
                "max": { "type": "number", "maximum": 5 }
              }
            }
            """;

        var errors = Validator.Validate(schema, """{"min":9,"max":6}""");

        Assert.Contains(errors, static error => error.Contains("$.min: number is less than the minimum value.", StringComparison.Ordinal));
        Assert.Contains(errors, static error => error.Contains("$.max: number exceeds the maximum value.", StringComparison.Ordinal));
    }

    [Fact]
    public void SimpleJsonSchemaValidator_reports_array_size_errors_and_indexed_paths()
    {
        var schema = """
            {
              "type": "array",
              "minItems": 2,
              "maxItems": 2,
              "items": { "type": "integer" }
            }
            """;

        var tooSmallErrors = Validator.Validate(schema, """[]""");
        var tooLargeErrors = Validator.Validate(schema, """[1,2,3]""");
        var indexedErrors = Validator.Validate(schema, """[1,"x"]""");

        Assert.Contains(tooSmallErrors, static error => error.Contains("$: array has fewer than the minimum number of items.", StringComparison.Ordinal));
        Assert.Contains(tooLargeErrors, static error => error.Contains("$: array has more than the maximum number of items.", StringComparison.Ordinal));
        Assert.Contains(indexedErrors, static error => error.Contains("$[1]: expected type '\"integer\"' but found 'String'.", StringComparison.Ordinal));
    }

    [Fact]
    public void SimpleJsonSchemaValidator_supports_union_types_and_unknown_type_values_are_ignored()
    {
        var unionSchema = """
            {
              "type": ["string", "null"]
            }
            """;
        var unknownTypeSchema = """
            {
              "type": "mystery"
            }
            """;

        Assert.Empty(Validator.Validate(unionSchema, "null"));
        Assert.Empty(Validator.Validate(unionSchema, "\"hello\""));
        Assert.Empty(Validator.Validate(unknownTypeSchema, "123"));
    }

    [Fact]
    public void SimpleJsonSchemaValidator_supports_boolean_array_and_null_primitive_types()
    {
        Assert.Empty(Validator.Validate("""{"type":"boolean"}""", "true"));
        Assert.Empty(Validator.Validate("""{"type":"array"}""", "[]"));
        Assert.Empty(Validator.Validate("""{"type":"null"}""", "null"));
    }

    [Fact]
    public void SimpleJsonSchemaValidator_ignores_non_string_and_non_array_type_definitions()
    {
        Assert.Empty(Validator.Validate("""{"type":123}""", "{\"anything\":true}"));
    }

    [Fact]
    public void SimpleJsonSchemaValidator_supports_date_time_uri_and_ignores_empty_or_unknown_format()
    {
        Assert.Empty(Validator.Validate("""{"type":"string","format":"date-time"}""", "\"2026-06-10T10:20:30Z\""));
        Assert.Empty(Validator.Validate("""{"type":"string","format":"uri"}""", "\"https://example.com\""));
        Assert.Empty(Validator.Validate("""{"type":"string","format":""}""", "\"anything\""));
        Assert.Empty(Validator.Validate("""{"type":"string","format":"custom"}""", "\"anything\""));
        Assert.Empty(Validator.Validate("""{"type":"string"}""", "\"anything\""));
    }
}