export * from './types.js';
export * from './matching-engine.js';
export * from './rule-parser.js';

export function createAiEngine() {
  return {
    version: '0.1.0',
    name: '@socialgrowth/ai-engine',
  };
}
