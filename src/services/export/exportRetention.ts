import { config, isExportStorageConfigured } from "../../config";
import { Logger } from "../../telemetry/logger";
import { deleteExportObjects, listExportObjects } from "./exportStorage";

const log = new Logger("export-retention");

export interface RetentionRunResult {
  deletedByAge: number;
  deletedBySize: number;
  remainingBytes: number;
  remainingCount: number;
}

export function selectObjectsForRetention(
  objects: { key: string; size: number; lastModified: Date }[],
  options: { maxAgeDays: number; maxBytes: number; now?: Date },
): { toDelete: string[]; ageDeleted: number; sizeDeleted: number; remaining: typeof objects } {
  const now = options.now ?? new Date();
  const cutoff = now.getTime() - options.maxAgeDays * 24 * 60 * 60 * 1000;

  const toDelete: string[] = [];
  let ageDeleted = 0;
  let remaining = objects.filter((obj) => {
    if (obj.lastModified.getTime() < cutoff) {
      toDelete.push(obj.key);
      ageDeleted += 1;
      return false;
    }
    return true;
  });

  let totalBytes = remaining.reduce((sum, obj) => sum + obj.size, 0);
  let sizeDeleted = 0;

  if (totalBytes > options.maxBytes) {
    const sorted = [...remaining].sort(
      (a, b) => a.lastModified.getTime() - b.lastModified.getTime(),
    );
    const kept: typeof objects = [];
    for (const obj of sorted) {
      if (totalBytes <= options.maxBytes) {
        kept.push(obj);
        continue;
      }
      toDelete.push(obj.key);
      sizeDeleted += 1;
      totalBytes -= obj.size;
    }
    remaining = kept;
  }

  return { toDelete, ageDeleted, sizeDeleted, remaining };
}

export async function runExportRetention(): Promise<RetentionRunResult | null> {
  if (!isExportStorageConfigured()) return null;

  const objects = await listExportObjects("exports/");
  const { toDelete, ageDeleted, sizeDeleted, remaining } = selectObjectsForRetention(objects, {
    maxAgeDays: config.exportCacheMaxAgeDays,
    maxBytes: config.exportBucketMaxBytes,
  });

  await deleteExportObjects(toDelete);

  return {
    deletedByAge: ageDeleted,
    deletedBySize: sizeDeleted,
    remainingBytes: remaining.reduce((sum, obj) => sum + obj.size, 0),
    remainingCount: remaining.length,
  };
}

export function scheduleExportRetention(
  run: () => Promise<RetentionRunResult | null> = runExportRetention,
): NodeJS.Timeout | null {
  if (!isExportStorageConfigured()) return null;

  const tick = () => {
    void run()
      .then((result) => {
        if (result && (result.deletedByAge > 0 || result.deletedBySize > 0)) {
          log.info(
            `deleted ${result.deletedByAge} by age, ${result.deletedBySize} by size; ` +
              `${result.remainingCount} objects (${Math.round(result.remainingBytes / (1024 * 1024))} MB) remain`,
          );
        }
      })
      .catch((err) => {
        log.error("failed:", err);
      });
  };

  tick();
  return setInterval(tick, config.exportRetentionIntervalMs);
}
