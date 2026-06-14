using Akka.Actor;
using Akka.Configuration;
using Aven.SchemaRegistry.Actors;

namespace Aven.Tests.SchemaRegistry;

public sealed class Phase05SchemaRegistryTests : IAsyncLifetime
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"aven-phase05-{Guid.NewGuid():N}.sqlite");
    private static readonly SchemaRef InvoiceSchemaRef = new("schema://accounting/invoice@3");

    [Fact]
    public async Task Register_Invoice_V1()
    {
        await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("schema-registry")), "schema-registry");
            var result = await actor.Ask<SchemaRegistered>(new SchemaRegister(InvoiceSchemaRef, InvoiceSchema(), "invoice schema"), TimeSpan.FromSeconds(3));

            Assert.Equal(InvoiceSchemaRef, result.SchemaRef);
            Assert.Equal("invoice schema", result.Description);
            return true;
        });
    }

    [Fact]
    public async Task ReRegister_SameVersion_DifferentSchema_Conflicts()
    {
        await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("schema-registry")), "schema-registry");
            await actor.Ask<SchemaRegistered>(new SchemaRegister(InvoiceSchemaRef, InvoiceSchema(), "invoice schema"), TimeSpan.FromSeconds(3));

            var conflict = await actor.Ask<SchemaRegistrationConflict>(
                new SchemaRegister(InvoiceSchemaRef, InvoiceSchemaWithDifferentRequiredFields(), "changed invoice schema"),
                TimeSpan.FromSeconds(3));

            Assert.Equal(InvoiceSchemaRef, conflict.SchemaRef);
            Assert.NotEqual(conflict.ExistingSchemaHash, conflict.IncomingSchemaHash);
            return true;
        });
    }

    [Fact]
    public async Task Validate_Valid_Invoice_Succeeds()
    {
        await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("schema-registry")), "schema-registry");
            await actor.Ask<SchemaRegistered>(new SchemaRegister(InvoiceSchemaRef, InvoiceSchema(), "invoice schema"), TimeSpan.FromSeconds(3));

            var result = await actor.Ask<SchemaValidationSucceeded>(
                new SchemaValidate(InvoiceSchemaRef, "{" + "\"invoiceNumber\":\"INV-1\",\"amount\":125.50}"),
                TimeSpan.FromSeconds(3));

            Assert.Equal(InvoiceSchemaRef, result.SchemaRef);
            return true;
        });
    }

    [Fact]
    public async Task Validate_Invalid_Invoice_Fails_WithDetails()
    {
        await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("schema-registry")), "schema-registry");
            await actor.Ask<SchemaRegistered>(new SchemaRegister(InvoiceSchemaRef, InvoiceSchema(), "invoice schema"), TimeSpan.FromSeconds(3));

            var result = await actor.Ask<SchemaValidationFailed>(
                new SchemaValidate(InvoiceSchemaRef, "{" + "\"invoiceNumber\":42}"),
                TimeSpan.FromSeconds(3));

            Assert.Equal(InvoiceSchemaRef, result.SchemaRef);
            Assert.NotEmpty(result.Errors);
            Assert.Contains(result.Errors, e => e.Contains("amount", StringComparison.OrdinalIgnoreCase) || e.Contains("expected type", StringComparison.OrdinalIgnoreCase));
            return true;
        });
    }

    [Fact]
    public async Task SchemaVersion_RemainsImmutable_AfterRestart()
    {
        await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("schema-registry")), "schema-registry");
            await actor.Ask<SchemaRegistered>(new SchemaRegister(InvoiceSchemaRef, InvoiceSchema(), "invoice schema"), TimeSpan.FromSeconds(3));
            return true;
        });

        await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("schema-registry")), "schema-registry");
            var schema = await actor.Ask<RegisteredSchema>(new SchemaGet(InvoiceSchemaRef), TimeSpan.FromSeconds(3));
            var conflict = await actor.Ask<SchemaRegistrationConflict>(
                new SchemaRegister(InvoiceSchemaRef, InvoiceSchemaWithDifferentRequiredFields(), "changed invoice schema"),
                TimeSpan.FromSeconds(3));

            Assert.Equal(InvoiceSchemaRef, schema.SchemaRef);
            Assert.Equal(InvoiceSchemaRef, conflict.SchemaRef);
            return true;
        });
    }

    [Fact]
    public async Task FamilyQueries_ReturnLatestAndListAllVersions_InOrder()
    {
        var invoiceV1 = new SchemaRef("schema://accounting/invoice@1");

        await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("schema-registry")), "schema-registry");
            await actor.Ask<SchemaRegistered>(new SchemaRegister(invoiceV1, InvoiceSchema(), "invoice schema v1"), TimeSpan.FromSeconds(3));
            await actor.Ask<SchemaRegistered>(new SchemaRegister(InvoiceSchemaRef, InvoiceSchemaV2(), "invoice schema v3"), TimeSpan.FromSeconds(3));

            var latest = await actor.Ask<RegisteredSchema>(new SchemaGetLatest("schema://accounting/invoice"), TimeSpan.FromSeconds(3));
            var versions = await actor.Ask<SchemaFamilyVersionsListed>(new SchemaListFamilyVersions("schema://accounting/invoice"), TimeSpan.FromSeconds(3));

            Assert.Equal(InvoiceSchemaRef, latest.SchemaRef);
            Assert.Equal("schema://accounting/invoice", latest.FamilyRef);
            Assert.Equal(3, latest.Version);
            Assert.Equal(new[] { invoiceV1, InvoiceSchemaRef }, versions.Schemas.Select(static x => x.SchemaRef).ToArray());
            return true;
        });
    }

    [Fact]
    public async Task UnknownFamilyQueries_ReturnFamilyNotFound()
    {
        await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("schema-registry")), "schema-registry");

            var latest = await actor.Ask<SchemaFamilyNotFound>(new SchemaGetLatest("schema://missing/family"), TimeSpan.FromSeconds(3));
            var list = await actor.Ask<SchemaFamilyNotFound>(new SchemaListFamilyVersions("schema://missing/family"), TimeSpan.FromSeconds(3));

            Assert.Equal("schema://missing/family", latest.FamilyRef);
            Assert.Equal("schema://missing/family", list.FamilyRef);
            return true;
        });
    }

    [Fact]
    public async Task Validate_AdditionalProperties_Arrays_Enums_And_Patterns_AreEnforced()
    {
        var strictSchemaRef = new SchemaRef("schema://accounting/strict-invoice@1");
        var strictSchema =
            """
            {
              "type": "object",
              "required": ["invoiceNumber", "status", "lines"],
              "additionalProperties": false,
              "properties": {
                "invoiceNumber": { "type": "string", "pattern": "^INV-[0-9]+$" },
                "status": { "type": "string", "enum": ["open", "paid"] },
                "lines": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "object",
                    "required": ["sku", "quantity"],
                    "additionalProperties": false,
                    "properties": {
                      "sku": { "type": "string" },
                      "quantity": { "type": "integer" }
                    }
                  }
                }
              }
            }
            """;

        await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("schema-registry")), "schema-registry");
            await actor.Ask<SchemaRegistered>(new SchemaRegister(strictSchemaRef, strictSchema, "strict invoice schema"), TimeSpan.FromSeconds(3));

            var valid = await actor.Ask<object>(
                new SchemaValidate(strictSchemaRef, """
                {
                  "invoiceNumber": "INV-100",
                  "status": "open",
                  "lines": [{ "sku": "A1", "quantity": 2 }]
                }
                """),
                TimeSpan.FromSeconds(3));

            Assert.IsType<SchemaValidationSucceeded>(valid);

            var invalidAdditional = await actor.Ask<SchemaValidationFailed>(
                new SchemaValidate(strictSchemaRef, """
                {
                  "invoiceNumber": "INV-100",
                  "status": "open",
                  "lines": [{ "sku": "A1", "quantity": 2 }],
                  "unexpected": true
                }
                """),
                TimeSpan.FromSeconds(3));
            Assert.Contains(invalidAdditional.Errors, e => e.Contains("additional property", StringComparison.OrdinalIgnoreCase));

            var invalidEnum = await actor.Ask<SchemaValidationFailed>(
                new SchemaValidate(strictSchemaRef, """
                {
                  "invoiceNumber": "INV-100",
                  "status": "pending",
                  "lines": [{ "sku": "A1", "quantity": 2 }]
                }
                """),
                TimeSpan.FromSeconds(3));
            Assert.Contains(invalidEnum.Errors, e => e.Contains("enum", StringComparison.OrdinalIgnoreCase));

            var invalidPattern = await actor.Ask<SchemaValidationFailed>(
                new SchemaValidate(strictSchemaRef, """
                {
                  "invoiceNumber": "BAD-100",
                  "status": "open",
                  "lines": [{ "sku": "A1", "quantity": 2 }]
                }
                """),
                TimeSpan.FromSeconds(3));
            Assert.Contains(invalidPattern.Errors, e => e.Contains("pattern", StringComparison.OrdinalIgnoreCase));

            var invalidArrayItem = await actor.Ask<SchemaValidationFailed>(
                new SchemaValidate(strictSchemaRef, """
                {
                  "invoiceNumber": "INV-100",
                  "status": "open",
                  "lines": [{ "sku": "A1", "quantity": "two" }]
                }
                """),
                TimeSpan.FromSeconds(3));
            Assert.Contains(invalidArrayItem.Errors, e => e.Contains("lines[0]", StringComparison.OrdinalIgnoreCase) || e.Contains("expected type", StringComparison.OrdinalIgnoreCase));
            return true;
        });
    }

    [Fact]
    public async Task Validate_Formats_NullableUnions_Lengths_AndNumericBounds_AreEnforced()
    {
        var schemaRef = new SchemaRef("schema://validation/edge-cases@1");
        var schema =
            """
            {
              "type": "object",
              "required": ["name", "amount", "effectiveDate", "observedAt", "referenceUri"],
              "properties": {
                "nickname": { "type": ["string", "null"] },
                "name": { "type": "string", "minLength": 3, "maxLength": 5 },
                "amount": { "type": "number", "minimum": 10, "maximum": 20 },
                "effectiveDate": { "type": "string", "format": "date" },
                "observedAt": { "type": "string", "format": "date-time" },
                "referenceUri": { "type": "string", "format": "uri" }
              }
            }
            """;

        await WithSystem(async system =>
        {
            var actor = system.ActorOf(Props.Create(() => new SchemaRegistryActor("schema-registry")), "schema-registry");
            await actor.Ask<SchemaRegistered>(new SchemaRegister(schemaRef, schema, "edge validation schema"), TimeSpan.FromSeconds(3));

            var valid = await actor.Ask<object>(new SchemaValidate(schemaRef,
                """
                {
                  "nickname": null,
                  "name": "Alice",
                  "amount": 12,
                  "effectiveDate": "2026-06-07",
                  "observedAt": "2026-06-07T12:00:00Z",
                  "referenceUri": "https://example.com/invoice/1"
                }
                """), TimeSpan.FromSeconds(3));
            Assert.IsType<SchemaValidationSucceeded>(valid);

            var invalid = await actor.Ask<SchemaValidationFailed>(new SchemaValidate(schemaRef,
                """
                {
                  "nickname": 5,
                  "name": "Al",
                  "amount": 25,
                  "effectiveDate": "07-06-2026",
                  "observedAt": "not-a-datetime",
                  "referenceUri": "not-a-uri"
                }
                """), TimeSpan.FromSeconds(3));

            Assert.Contains(invalid.Errors, e => e.Contains("expected type", StringComparison.OrdinalIgnoreCase));
            Assert.Contains(invalid.Errors, e => e.Contains("minimum length", StringComparison.OrdinalIgnoreCase));
            Assert.Contains(invalid.Errors, e => e.Contains("maximum value", StringComparison.OrdinalIgnoreCase));
            Assert.Contains(invalid.Errors, e => e.Contains("format 'date'", StringComparison.OrdinalIgnoreCase));
            Assert.Contains(invalid.Errors, e => e.Contains("format 'date-time'", StringComparison.OrdinalIgnoreCase));
            Assert.Contains(invalid.Errors, e => e.Contains("format 'uri'", StringComparison.OrdinalIgnoreCase));
            return true;
        });
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        if (File.Exists(_databasePath))
        {
            File.Delete(_databasePath);
        }

        return Task.CompletedTask;
    }

    private async Task<T> WithSystem<T>(Func<ActorSystem, Task<T>> action)
    {
        var config = ConfigurationFactory.ParseString($$"""
            akka {
              loglevel = WARNING
              stdout-loglevel = WARNING
              persistence {
                journal.plugin = "akka.persistence.journal.sqlite"
                snapshot-store.plugin = "akka.persistence.snapshot-store.sqlite"
                journal.sqlite {
                  class = "Akka.Persistence.Sqlite.Journal.SqliteJournal, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{EscapeForHocon(_databasePath)}}"
                  auto-initialize = on
                }
                snapshot-store.sqlite {
                  class = "Akka.Persistence.Sqlite.Snapshot.SqliteSnapshotStore, Akka.Persistence.Sqlite"
                  plugin-dispatcher = "akka.actor.default-dispatcher"
                  connection-string = "Data Source={{EscapeForHocon(_databasePath)}}"
                  auto-initialize = on
                }
              }
            }
            """);

        var system = ActorSystem.Create($"aven-phase05-{Guid.NewGuid():N}", config);
        try
        {
            return await action(system);
        }
        finally
        {
            await system.Terminate();
        }
    }

    private static string EscapeForHocon(string path) => path.Replace("\\", "\\\\", StringComparison.Ordinal);

    private static string InvoiceSchema() =>
        """
        {
          "type": "object",
          "required": ["invoiceNumber", "amount"],
          "properties": {
            "invoiceNumber": { "type": "string" },
            "amount": { "type": "number" }
          }
        }
        """;

    private static string InvoiceSchemaWithDifferentRequiredFields() =>
        """
        {
          "type": "object",
          "required": ["invoiceNumber", "amount", "currency"],
          "properties": {
            "invoiceNumber": { "type": "string" },
            "amount": { "type": "number" },
            "currency": { "type": "string" }
          }
        }
        """;

    private static string InvoiceSchemaV2() =>
        """
        {
          "type": "object",
          "required": ["invoiceNumber", "amount", "currency"],
          "properties": {
            "invoiceNumber": { "type": "string" },
            "amount": { "type": "number" },
            "currency": { "type": "string" }
          }
        }
        """;
}