export type {
  BundledSchemaBinding as DefaultExtractionSchemaBinding,
  BundledSchemaCatalogEntry as DefaultExtractionSchemaCatalogEntry,
  BundledSchemaDefinition as ExtractionSchemaDefinition,
} from "./actors/registry/catalog.ts";
export {
  getCurrentDefaultExtractionSchemaRef,
  getBundledSchemaCatalogEntry as getDefaultExtractionSchemaCatalogEntry,
  listCurrentDefaultExtractionSchemas,
  listBundledSchemaBindings as listDefaultExtractionSchemaBindings,
  listBundledSchemaCatalogEntries as listDefaultExtractionSchemaCatalogEntries,
} from "./actors/registry/catalog.ts";