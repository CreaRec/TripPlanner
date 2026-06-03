import { config } from "../config";
import { openai } from "./client";

/** Create an embedding vector for a single piece of text. */
export async function embed(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: config.embeddingModel,
    input: text.replace(/\n/g, " ").slice(0, 8000),
  });
  return response.data[0].embedding;
}

/** Format a numeric vector as a pgvector literal, e.g. "[0.1,0.2,...]". */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
