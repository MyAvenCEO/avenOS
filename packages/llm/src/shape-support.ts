import {
  llmsShape,
  llmProviderShape,
  llmModelShape,
  llmRequestWorkerShape,
} from "./actors/llms/shape.ts";

export interface LlmShapeBundle {
  readonly llmsShape: typeof llmsShape;
  readonly llmProviderShape: typeof llmProviderShape;
  readonly llmModelShape: typeof llmModelShape;
  readonly llmRequestWorkerShape: typeof llmRequestWorkerShape;
}

export function createLlmShapeBundle(): LlmShapeBundle {
  return {
    llmsShape,
    llmProviderShape,
    llmModelShape,
    llmRequestWorkerShape,
  };
}