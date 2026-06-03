import { prisma } from "../db/prisma";
import { embed, toVectorLiteral } from "../openai/embeddings";

export interface MemoryRecord {
  id: number;
  trip_id: number | null;
  kind: string;
  content: string;
}

export interface SaveMemoryInput {
  telegramId: number;
  tripId?: number | null;
  kind?: string;
  content: string;
}

export async function saveMemory(input: SaveMemoryInput): Promise<MemoryRecord> {
  const vector = toVectorLiteral(await embed(input.content));
  // The embedding column is Unsupported() in Prisma, so we insert via raw SQL
  // and cast the vector literal parameter to ::vector.
  const rows = await prisma.$queryRaw<MemoryRecord[]>`
    INSERT INTO memories (telegram_id, trip_id, kind, content, embedding)
    VALUES (${BigInt(input.telegramId)}, ${input.tripId ?? null}, ${input.kind ?? "fact"}, ${input.content}, ${vector}::vector)
    RETURNING id, trip_id, kind, content
  `;
  return rows[0];
}

export interface SearchMemoryInput {
  telegramId: number;
  tripId?: number | null;
  queryText: string;
  limit?: number;
}

export async function searchMemories(input: SearchMemoryInput): Promise<MemoryRecord[]> {
  const vector = toVectorLiteral(await embed(input.queryText));
  const limit = input.limit ?? 6;
  const tripId = input.tripId ?? null;
  // Match global memories (trip_id IS NULL) or those scoped to the active trip,
  // ordered by cosine distance.
  return prisma.$queryRaw<MemoryRecord[]>`
    SELECT id, trip_id, kind, content
      FROM memories
     WHERE telegram_id = ${BigInt(input.telegramId)}
       AND (trip_id IS NULL OR trip_id = ${tripId})
     ORDER BY embedding <=> ${vector}::vector
     LIMIT ${limit}
  `;
}

export async function listMemories(
  telegramId: number,
  tripId?: number | null,
): Promise<MemoryRecord[]> {
  const rows = await prisma.memory.findMany({
    where: {
      telegramId: BigInt(telegramId),
      ...(tripId != null ? { OR: [{ tripId: null }, { tripId }] } : {}),
    },
    select: { id: true, tripId: true, kind: true, content: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ id: r.id, trip_id: r.tripId, kind: r.kind, content: r.content }));
}

export async function deleteMemory(
  telegramId: number,
  memoryId: number,
  tripId?: number | null,
): Promise<boolean> {
  const result = await prisma.memory.deleteMany({
    where: {
      id: memoryId,
      telegramId: BigInt(telegramId),
      ...(tripId !== undefined ? { OR: [{ tripId: null }, { tripId }] } : {}),
    },
  });
  return result.count > 0;
}

export async function replaceMemory(input: SaveMemoryInput & { memoryId: number }): Promise<MemoryRecord | null> {
  const deleted = await deleteMemory(input.telegramId, input.memoryId, input.tripId);
  if (!deleted) return null;
  return saveMemory(input);
}
