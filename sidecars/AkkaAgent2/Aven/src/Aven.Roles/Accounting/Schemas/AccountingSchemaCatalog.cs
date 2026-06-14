using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Aven.Roles.Accounting.Schemas;

public static class AccountingSchemaCatalog
{
    // Extraction schemas (LLM structured-output targets) — the rich, document-faithful "essence" shapes.
    public static string InvoiceExtractionV1Json { get; } = LoadAndNormalizeEmbeddedSchema("accounting_invoice_schema_essence.json", EnhanceInvoiceSchema);
    public static string AccountStatementExtractionV1Json { get; } = LoadAndNormalizeEmbeddedSchema("accounting_bank_statement_schema_essence.json", EnhanceAccountStatementSchema);

    public static string DocumentClassificationV1Json { get; } =
        """
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["document_kind", "confidence", "reason"],
          "properties": {
            "document_kind": {
              "type": "string",
              "enum": ["invoice_like", "account_statement", "unsupported"]
            },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
            "reason": { "type": "string" }
          }
        }
        """;

    // Canonical schemas (stored / queried / matched) — normalized money, ISO dates, ISO currency, validation issues.
    public static string InvoiceV3Json { get; } = BuildInvoiceCanonicalSchema();
    public static string AccountStatementV3Json { get; } = BuildAccountStatementCanonicalSchema();
    public static string StatementTransactionV3Json { get; } = BuildStatementTransactionCanonicalSchema();
    public static string PaymentMatchV3Json { get; } = BuildPaymentMatchCanonicalSchema();

    public static IReadOnlyList<KeyValuePair<SchemaRef, string>> All { get; } =
    [
        new(AccountingSchemaRefs.DocumentClassificationV1, DocumentClassificationV1Json),
        new(AccountingSchemaRefs.InvoiceExtractionV1, InvoiceExtractionV1Json),
        new(AccountingSchemaRefs.AccountStatementExtractionV1, AccountStatementExtractionV1Json),
        new(AccountingSchemaRefs.InvoiceV3, InvoiceV3Json),
        new(AccountingSchemaRefs.AccountStatementV3, AccountStatementV3Json),
        new(AccountingSchemaRefs.StatementTransactionV3, StatementTransactionV3Json),
        new(AccountingSchemaRefs.PaymentMatchV3, PaymentMatchV3Json)
    ];

    // ----- Canonical @3 schema builders -------------------------------------------------

    private static string BuildInvoiceCanonicalSchema() =>
        Obj(new JsonObject
        {
            ["vendor_name"] = NullableString(),
            ["invoice_number"] = NullableString(),
            ["issue_date"] = NullableDate(),
            ["due_date"] = NullableDate(),
            ["currency"] = CurrencyField(),
            ["subtotal"] = Money(),
            ["tax_total"] = Money(),
            ["invoice_total"] = Money(),
            ["total_outstanding"] = Money(),
            ["normalization"] = NormalizationSchema(),
            ["source_document"] = OpenObject()
        }).ToJsonString();

    private static string BuildAccountStatementCanonicalSchema() =>
        Obj(new JsonObject
        {
            ["institution_name"] = NullableString(),
            ["account_iban"] = NullableString(),
            ["currency"] = CurrencyField(),
            ["period_start"] = NullableDate(),
            ["period_end"] = NullableDate(),
            ["opening_balance"] = Money(),
            ["closing_balance"] = Money(),
            ["transaction_count"] = new JsonObject { ["type"] = "integer", ["minimum"] = 0 },
            ["transactions"] = new JsonObject { ["type"] = "array", ["items"] = TransactionSchema(includeStatementSubjectId: false) },
            ["normalization"] = NormalizationSchema(),
            ["source_document"] = OpenObject()
        }).ToJsonString();

    private static string BuildStatementTransactionCanonicalSchema() =>
        TransactionSchema(includeStatementSubjectId: true).ToJsonString();

    private static string BuildPaymentMatchCanonicalSchema() =>
        Obj(
            new JsonObject
            {
                ["match_id"] = RequiredString(),
                ["invoice_subject_id"] = RequiredString(),
                ["statement_subject_id"] = NullableString(),
                ["transaction_id"] = NullableString(),
                ["transaction_index"] = new JsonObject { ["type"] = Types("integer", "null"), ["minimum"] = 0 },
                ["supplier_name"] = NullableString(),
                ["invoice_number"] = NullableString(),
                ["invoice_amount"] = Money(),
                ["matched_amount"] = Money(),
                ["currency"] = NullableCurrencyField(),
                ["status"] = new JsonObject { ["type"] = "string", ["enum"] = Arr("paid", "unpaid", "partial", "needs_review", "unknown", "uncertain") },
                ["confidence"] = new JsonObject { ["type"] = "number", ["minimum"] = 0, ["maximum"] = 1 },
                ["reason"] = RequiredString(),
                ["matched_date"] = NullableDate(),
                ["review_prompt_id"] = NullableString(),
                ["matched_on"] = new JsonObject
                {
                    ["type"] = "array",
                    ["items"] = new JsonObject { ["type"] = "string", ["enum"] = Arr("amount", "currency", "supplier_name", "invoice_number", "iban", "reference", "date_window") }
                }
            },
            required: ["match_id", "invoice_subject_id", "status", "confidence", "reason"]).ToJsonString();

    private static JsonObject TransactionSchema(bool includeStatementSubjectId)
    {
        var properties = new JsonObject
        {
            ["transaction_id"] = RequiredString(),
            ["transaction_index"] = new JsonObject { ["type"] = "integer", ["minimum"] = 0 },
            ["booking_date"] = NullableDate(),
            ["booking_date_as_printed"] = NullableString(),
            ["value_date"] = NullableDate(),
            ["description"] = NullableString(),
            ["counterparty_name"] = NullableString(),
            ["title"] = NullableString(),
            ["amount"] = Money(),
            ["direction"] = new JsonObject { ["type"] = "string", ["enum"] = Arr("debit", "credit") },
            ["original_amount"] = Money(),
            ["original_currency"] = NullableString(),
            ["exchange_rate"] = NullableString(),
            ["balance_after"] = Money()
        };

        if (includeStatementSubjectId)
        {
            // statement_subject_id is the first property so it appears in the required set below.
            var withStatement = new JsonObject { ["statement_subject_id"] = RequiredString() };
            foreach (var property in properties.ToArray())
            {
                properties.Remove(property.Key);
                withStatement[property.Key] = property.Value;
            }

            properties = withStatement;
        }

        return Obj(properties);
    }

    // ----- Schema fragment helpers ------------------------------------------------------

    private static JsonObject Obj(JsonObject properties, IReadOnlyList<string>? required = null)
    {
        var requiredArray = new JsonArray();
        foreach (var key in required ?? properties.Select(static p => p.Key).ToArray())
        {
            requiredArray.Add(key);
        }

        return new JsonObject
        {
            ["type"] = "object",
            ["additionalProperties"] = false,
            ["required"] = requiredArray,
            ["properties"] = properties
        };
    }

    private static JsonObject Money() => new()
    {
        ["type"] = Types("object", "null"),
        ["additionalProperties"] = false,
        ["required"] = Arr("amount", "currency", "minor_units"),
        ["properties"] = new JsonObject
        {
            ["amount"] = new JsonObject { ["type"] = "number" },
            ["currency"] = CurrencyField(),
            ["minor_units"] = new JsonObject { ["type"] = "integer" }
        }
    };

    private static JsonObject NormalizationSchema() => new()
    {
        ["type"] = "object",
        ["additionalProperties"] = false,
        ["required"] = Arr("source_schema", "issues"),
        ["properties"] = new JsonObject
        {
            ["source_schema"] = RequiredString(),
            ["issues"] = new JsonObject
            {
                ["type"] = "array",
                ["items"] = new JsonObject
                {
                    ["type"] = "object",
                    ["additionalProperties"] = false,
                    ["required"] = Arr("code", "field", "severity", "message"),
                    ["properties"] = new JsonObject
                    {
                        ["code"] = RequiredString(),
                        ["field"] = RequiredString(),
                        ["severity"] = new JsonObject { ["type"] = "string", ["enum"] = Arr("warning", "error") },
                        ["message"] = RequiredString()
                    }
                }
            }
        }
    };

    private static JsonObject RequiredString() => new() { ["type"] = "string" };
    private static JsonObject NullableString() => new() { ["type"] = Types("string", "null") };
    private static JsonObject NullableDate() => new() { ["type"] = Types("string", "null"), ["format"] = "date" };
    private static JsonObject CurrencyField() => new() { ["type"] = "string", ["pattern"] = "^([A-Z]{3}|UNKNOWN)$" };
    private static JsonObject NullableCurrencyField() => new() { ["type"] = Types("string", "null"), ["pattern"] = "^([A-Z]{3}|UNKNOWN)$" };
    private static JsonObject OpenObject() => new() { ["type"] = "object" };
    private static JsonArray Types(params string[] types) => Arr(types);

    private static JsonArray Arr(params string[] values)
    {
        var array = new JsonArray();
        foreach (var value in values)
        {
            array.Add(value);
        }

        return array;
    }

    // ----- Embedded extraction-schema loading (unchanged behavior) ----------------------

    private static string LoadAndNormalizeEmbeddedSchema(string suffix, Action<JsonObject> mutator)
    {
        var assembly = typeof(AccountingSchemaCatalog).Assembly;
        var resourceName = assembly.GetManifestResourceNames().Single(name => name.EndsWith(suffix, StringComparison.OrdinalIgnoreCase));
        using var stream = assembly.GetManifestResourceStream(resourceName) ?? throw new InvalidOperationException($"Embedded schema resource '{resourceName}' was not found.");
        using var reader = new StreamReader(stream);
        var text = reader.ReadToEnd();
        var node = JsonNode.Parse(text)?.AsObject() ?? throw new InvalidOperationException($"Embedded schema resource '{resourceName}' did not contain a JSON object.");
        mutator(node);
        NormalizeForStructuredOutputs(node);
        return node.ToJsonString(new JsonSerializerOptions { WriteIndented = false });
    }

    private static void NormalizeForStructuredOutputs(JsonNode? node)
    {
        switch (node)
        {
            case JsonObject obj:
                NormalizeObjectForStructuredOutputs(obj);
                break;
            case JsonArray array:
                foreach (var child in array)
                {
                    NormalizeForStructuredOutputs(child);
                }
                break;
        }
    }

    private static void NormalizeObjectForStructuredOutputs(JsonObject obj)
    {
        if (obj["properties"] is JsonObject properties)
        {
            obj["additionalProperties"] ??= false;
            obj["required"] = new JsonArray(properties.Select(static property => JsonValue.Create(property.Key)).ToArray());

            foreach (var property in properties)
            {
                NormalizeForStructuredOutputs(property.Value);
            }
        }

        if (obj["items"] is not null)
        {
            NormalizeForStructuredOutputs(obj["items"]);
        }

        foreach (var keyword in new[] { "anyOf", "oneOf", "allOf" })
        {
            if (obj[keyword] is JsonArray variants)
            {
                foreach (var variant in variants)
                {
                    NormalizeForStructuredOutputs(variant);
                }
            }
        }
    }

    private static void EnhanceInvoiceSchema(JsonObject root)
    {
        SetFormat(root, "header", "letter_date", "date");
        SetFormat(root, "header", "due_date", "date");
        SetFormat(root, "header", "issue_date", "date");
    }

    private static void EnhanceAccountStatementSchema(JsonObject root)
    {
        SetRootPropertyFormat(root, "statement_issue_date", "date");
        SetRootPropertyFormat(root, "period_start", "date");
        SetRootPropertyFormat(root, "period_end", "date");
        SetRootPropertyFormat(root, "payment_due_date", "date");

        if (root["properties"] is JsonObject rootProperties
            && rootProperties["account_holder"] is JsonObject accountHolder
            && accountHolder["properties"] is JsonObject accountHolderProperties
            && accountHolderProperties["identity_id"] is null)
        {
            accountHolderProperties["identity_id"] = new JsonObject
            {
                ["type"] = new JsonArray("string", "null")
            };
        }

        if (root["properties"] is JsonObject properties
            && properties["transactions"] is JsonObject transactions
            && transactions["items"] is JsonObject items
            && items["properties"] is JsonObject itemProperties)
        {
            SetPropertyFormat(itemProperties, "booking_date", "date");
            SetPropertyFormat(itemProperties, "value_date", "date");
            // `description` and `title` are already defined (with hints) in the source schema; do not clobber them.
        }
    }

    private static void SetRootPropertyFormat(JsonObject root, string propertyName, string format)
    {
        if (root["properties"] is JsonObject properties)
        {
            SetPropertyFormat(properties, propertyName, format);
        }
    }

    private static void SetPropertyFormat(JsonObject properties, string propertyName, string format)
    {
        if (properties[propertyName] is JsonObject property)
        {
            property["format"] = format;
        }
    }

    private static void SetFormat(JsonObject root, string objectProperty, string propertyName, string format)
    {
        if (root["properties"] is JsonObject properties
            && properties[objectProperty] is JsonObject obj
            && obj["properties"] is JsonObject nested)
        {
            SetPropertyFormat(nested, propertyName, format);
        }
    }
}
