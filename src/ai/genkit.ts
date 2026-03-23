import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

export const ai = genkit({
  plugins: [googleAI({ apiKey: 'AIzaSyBqxYAvishdDQnVYDGyhfopSFiJUtHCXIA' })],
  model: 'googleai/gemini-2.5-flash', // Default model
});

/**
 * A utility function that executes a given AI operation with built-in exponential backoff 
 * and automatic fallback to secondary models if the primary model fails or hits rate limits.
 */
export async function executeWithRetryAndFallback<T>(
  operation: (modelName: string) => Promise<T>
): Promise<T> {
  const models = [
    'googleai/gemini-2.5-flash',
    'googleai/gemini-1.5-flash',
    'googleai/gemini-1.5-pro',
  ];

  const maxRetriesPerModel = 3;
  const baseDelayMs = 2000;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex];

    for (let attempt = 0; attempt < maxRetriesPerModel; attempt++) {
      try {
        console.log(`[Genkit] Generating with model ${model} (Attempt ${attempt + 1})`);
        return await operation(model);
      } catch (error: any) {
        console.error(`[Genkit] Error with model ${model} (Attempt ${attempt + 1}):`, error.message || error);

        if (attempt === maxRetriesPerModel - 1) {
          console.log(`[Genkit] Exhausted retries for ${model}, switching to next model...`);
          break;
        }

        // Exponential backoff
        const delayMs = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
        console.log(`[Genkit] Waiting ${Math.round(delayMs)}ms before retrying...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error("All AI models and retries exhausted due to rate limits or errors. Please try again later.");
}
