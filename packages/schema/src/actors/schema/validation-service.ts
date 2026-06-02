import type { JsonValue } from "typed-actors";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { cloneJsonValue } from "shared";
import { hashSchema, schemaError, type RegisteredSchemaVersion, type SchemaRef, type SchemaValidationResult } from "../../domain.ts";

export interface SchemaValidationService {
  validateSchemaDocument(schemaRef: SchemaRef, schema: unknown): SchemaValidationResult;
  validateValue(registered: RegisteredSchemaVersion, value: unknown): SchemaValidationResult;
  validateAdhocValue(schema: unknown, value: unknown): readonly string[];
}

function toAjvDetails(errors: readonly ErrorObject[] | null | undefined): unknown {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message,
    params: error.params,
  }));
}

function cloneSchema<T>(value: T): T {
  return cloneJsonValue(value);
}

class AjvSchemaValidationService implements SchemaValidationService {
  private readonly metaAjv = new Ajv({ allErrors: true, strict: false, validateSchema: true });
  private readonly runtimeAjv = new Ajv({ allErrors: true, strict: false, validateSchema: true });
  private readonly validatorCache = new Map<string, ValidateFunction>();

  validateSchemaDocument(schemaRef: SchemaRef, schema: unknown): SchemaValidationResult {
    const schemaHash = hashSchema(schema);
    const validationSchema = cloneSchema(schema) as object;
    if (!this.metaAjv.validateSchema(validationSchema)) {
      return schemaError(
        schemaRef,
        "schemaInvalid",
        "SCHEMA_META_VALIDATION_FAILED",
        "Schema document is not a valid JSON Schema.",
        toAjvDetails(this.metaAjv.errors),
      );
    }
    try {
      this.getOrCreateValidator({ schemaRef, schemaHash, schema: cloneSchema(schema), registeredAt: new Date(0).toISOString() });
      return { type: "ok", schemaRef, schemaHash };
    } catch (error) {
      return schemaError(
        schemaRef,
        "schemaInvalid",
        "SCHEMA_COMPILE_FAILED",
        error instanceof Error ? error.message : "Schema compilation failed.",
      );
    }
  }

  validateValue(registered: RegisteredSchemaVersion, value: unknown): SchemaValidationResult {
    const validator = this.getOrCreateValidator(registered);
    if (validator(value)) {
      return {
        type: "ok",
        schemaRef: registered.schemaRef,
        schemaHash: registered.schemaHash,
      };
    }
    return schemaError(
      registered.schemaRef,
      "schemaInvalid",
      "SCHEMA_VALUE_VALIDATION_FAILED",
      "JSON value does not satisfy the schema.",
      toAjvDetails(validator.errors),
    );
  }

  validateAdhocValue(schema: unknown, value: unknown): readonly string[] {
    try {
      const validator = this.runtimeAjv.compile(cloneSchema(schema) as object);
      if (validator(value)) {
        return [];
      }
      return (validator.errors ?? []).map((error: ErrorObject) => formatAjvError(error));
    } catch (error) {
      return [error instanceof Error ? error.message : "Schema compilation failed."];
    }
  }

  private getOrCreateValidator(registered: RegisteredSchemaVersion): ValidateFunction {
    const cacheKey = `${registered.schemaRef.schemaId}@${registered.schemaRef.version}:${registered.schemaHash}`;
    const existing = this.validatorCache.get(cacheKey);
    if (existing) {
      return existing;
    }
    const validator = this.runtimeAjv.compile(cloneSchema(registered.schema) as object);
    this.validatorCache.set(cacheKey, validator);
    return validator;
  }
}

function formatAjvError(error: ErrorObject): string {
  const path = error.instancePath === "" ? "$" : `$${error.instancePath.replace(/\//gu, ".")}`;
  return error.message ? `${path} ${error.message}` : `${path} is invalid`;
}

export function createSchemaValidationService(): SchemaValidationService {
  return new AjvSchemaValidationService();
}
