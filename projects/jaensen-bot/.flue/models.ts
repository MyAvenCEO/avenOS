/**
 * Model registry for easy model configuration
 * Add new models here to make them available to agents
 */

export interface ModelConfig {
  provider: string;
  modelId: string;
  api: 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'mistral-conversations';
  baseUrl: string;
  apiKey: string;
  reasoning?: boolean;
}

export const models: Record<string, ModelConfig> = {
  // Local models (e.g., via local LLM server)
  'minimax-m2.7-nvfp4': {
    provider: 'minimax',
    modelId: 'minimax-m2.7-nvfp4',
    api: 'openai-completions',
    baseUrl: process.env.OPENAI_BASE_URL || 'http://box:8000/v1',
    apiKey: process.env.OPENAI_API_KEY || 'local',
    reasoning: true,
  },
  
  // Example: GLM via local server
  // 'glm-4': {
  //   provider: 'glm',
  //   modelId: 'glm-4',
  //   api: 'openai-completions',
  //   baseUrl: process.env.OPENAI_BASE_URL || 'http://box:8000/v1',
  //   apiKey: process.env.OPENAI_API_KEY || 'local',
  // },
  
  // Example: Gemma via local server
  // 'gemma-2b': {
  //   provider: 'gemma',
  //   modelId: 'gemma-2b',
  //   api: 'openai-completions',
  //   baseUrl: process.env.OPENAI_BASE_URL || 'http://box:8000/v1',
  //   apiKey: process.env.OPENAI_API_KEY || 'local',
  // },
};

export function getModel(modelKey: string): ModelConfig | undefined {
  return models[modelKey];
}

export function getAllModels(): ModelConfig[] {
  return Object.values(models);
}