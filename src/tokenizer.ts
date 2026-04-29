import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";

export const TOKENIZER_NAME = "cl100k_base";

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return countTokens(text);
}
