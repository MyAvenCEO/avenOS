import type { FlueContext } from '@flue/sdk/client';
import { registerProvider, configureProvider } from '@flue/sdk/app';
import { getModel } from '../models';

// Register all models from the model registry
const modelKey = process.env.DEFAULT_MODEL || 'minimax-m2.7-nvfp4';
const modelConfig = getModel(modelKey);

if (!modelConfig) {
  throw new Error(`Model "${modelKey}" not found in model registry. Add it to .flue/models.ts`);
}

registerProvider(modelConfig.provider, {
  api: modelConfig.api,
  baseUrl: modelConfig.baseUrl,
  apiKey: modelConfig.apiKey,
});

configureProvider(modelConfig.provider, {
  baseUrl: modelConfig.baseUrl,
  apiKey: modelConfig.apiKey,
});

export const triggers = { webhook: true };

export default async function ({ init, payload }: FlueContext) {
  const harness = await init({
    model: `${modelConfig.provider}/${modelConfig.modelId}`
  });
  const session = await harness.session();
  const result = await session.prompt(
    payload.message || 'Say hello in a friendly way!'
  );
  return { response: result };
}