import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config, isExportStorageConfigured } from "../../config";
import { ExportFormat } from "./exportFormat";

export const EXPORT_FINGERPRINT_METADATA_KEY = "export-fingerprint";

let s3Client: S3Client | null = null;

export function getS3Client(): S3Client | null {
  if (!isExportStorageConfigured()) return null;
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.awsRegion!,
      ...(config.awsAccessKeyId && config.awsSecretAccessKey
        ? {
            credentials: {
              accessKeyId: config.awsAccessKeyId,
              secretAccessKey: config.awsSecretAccessKey,
            },
          }
        : {}),
    });
  }
  return s3Client;
}

/** @internal Test helper */
export function resetS3ClientForTests(): void {
  s3Client = null;
}

export function itineraryExportKey(tripId: number, format: ExportFormat): string {
  const ext = format === ExportFormat.Pdf ? "pdf" : "csv";
  return `exports/itinerary/${tripId}/export.${ext}`;
}

export function gmailExportPrefix(gmailAccountId: number, messageId: string): string {
  return `exports/gmail/${gmailAccountId}/${messageId}/`;
}

export function gmailManifestKey(gmailAccountId: number, messageId: string): string {
  return `${gmailExportPrefix(gmailAccountId, messageId)}manifest.json`;
}

export function gmailPdfKey(gmailAccountId: number, messageId: string): string {
  return `${gmailExportPrefix(gmailAccountId, messageId)}message.pdf`;
}

export function gmailAttachmentKey(
  gmailAccountId: number,
  messageId: string,
  sanitizedFilename: string,
): string {
  return `${gmailExportPrefix(gmailAccountId, messageId)}attachments/${sanitizedFilename}`;
}

export function routeMapExportKey(routeHash: string): string {
  return `exports/maps/${routeHash}.png`;
}

export function hashRouteMapInput(input: {
  origin: string;
  destination: string;
  stopName: string;
  baseEncodedPolyline: string;
  detourEncodedPolyline: string;
}): string {
  const payload = JSON.stringify({
    origin: input.origin,
    destination: input.destination,
    stopName: input.stopName,
    baseEncodedPolyline: input.baseEncodedPolyline,
    detourEncodedPolyline: input.detourEncodedPolyline,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export interface CachedExport {
  key: string;
  fingerprint?: string;
}

export interface GmailExportManifest {
  pdfKey: string;
  attachmentKeys: string[];
  skippedAttachments: { filename: string; size: number; reason: "too_large" }[];
  subject: string;
  from: string;
  date: string | null;
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ("name" in err && (err.name === "NotFound" || err.name === "NoSuchKey")) return true;
  if ("$metadata" in err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    return status === 404;
  }
  return false;
}

/** S3 returns 403 instead of 404 for missing keys when s3:ListBucket is denied. */
function isCacheLookupMissError(err: unknown): boolean {
  if (isNotFoundError(err)) return true;
  if (!err || typeof err !== "object") return false;
  if ("name" in err && err.name === "AccessDenied") return true;
  if ("Code" in err && err.Code === "AccessDenied") return true;
  if ("$metadata" in err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    return status === 403;
  }
  return false;
}

function ensureTempDir(): string {
  const dir = resolve(config.dataDir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function getCachedExport(
  key: string,
  options?: { expectedFingerprint?: string },
): Promise<CachedExport | null> {
  const client = getS3Client();
  if (!client || !config.s3Bucket) return null;

  try {
    const response = await client.send(
      new HeadObjectCommand({ Bucket: config.s3Bucket, Key: key }),
    );
    const storedFingerprint = response.Metadata?.[EXPORT_FINGERPRINT_METADATA_KEY];
    if (
      options?.expectedFingerprint !== undefined &&
      storedFingerprint !== options.expectedFingerprint
    ) {
      return null;
    }
    return { key, fingerprint: storedFingerprint };
  } catch (err: unknown) {
    if (isCacheLookupMissError(err)) return null;
    throw err;
  }
}

export async function getCachedGmailExport(
  gmailAccountId: number,
  messageId: string,
): Promise<{ manifest: GmailExportManifest; keys: string[] } | null> {
  const client = getS3Client();
  if (!client || !config.s3Bucket) return null;

  const manifestKey = gmailManifestKey(gmailAccountId, messageId);
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: config.s3Bucket, Key: manifestKey }),
    );
    const body = await response.Body?.transformToString();
    if (!body) return null;
    const manifest = JSON.parse(body) as GmailExportManifest;
    return {
      manifest,
      keys: [manifest.pdfKey, ...manifest.attachmentKeys],
    };
  } catch (err: unknown) {
    if (isCacheLookupMissError(err)) return null;
    throw err;
  }
}

export async function storeExportObject(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
  options?: { fingerprint?: string },
): Promise<void> {
  const client = getS3Client();
  if (!client || !config.s3Bucket) {
    throw new Error("S3 export storage is not configured.");
  }

  await client.send(
    new PutObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
      Body: typeof body === "string" ? Buffer.from(body) : body,
      ContentType: contentType,
      Metadata:
        options?.fingerprint !== undefined
          ? { [EXPORT_FINGERPRINT_METADATA_KEY]: options.fingerprint }
          : undefined,
    }),
  );
}

export async function storeExportFromFile(
  key: string,
  localPath: string,
  contentType: string,
  options?: { fingerprint?: string },
): Promise<void> {
  await storeExportObject(key, readFileSync(localPath), contentType, options);
}

export async function storeGmailExportManifest(
  gmailAccountId: number,
  messageId: string,
  manifest: GmailExportManifest,
): Promise<void> {
  await storeExportObject(
    gmailManifestKey(gmailAccountId, messageId),
    JSON.stringify(manifest),
    "application/json",
  );
}

export async function materializeForTelegram(keys: string[]): Promise<string[]> {
  const client = getS3Client();
  if (!client || !config.s3Bucket) {
    throw new Error("S3 export storage is not configured.");
  }

  const dir = ensureTempDir();
  const paths: string[] = [];

  for (const key of keys) {
    const response = await client.send(
      new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }),
    );
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Empty S3 object: ${key}`);

    const localPath = join(dir, key.replace(/\//g, "_"));
    writeFileSync(localPath, bytes);
    paths.push(localPath);
  }

  return paths;
}

export async function materializeSingleForTelegram(key: string): Promise<string> {
  const [path] = await materializeForTelegram([key]);
  return path!;
}

export async function invalidateExport(prefix: string): Promise<void> {
  const client = getS3Client();
  if (!client || !config.s3Bucket) return;

  let continuationToken: string | undefined;
  do {
    const listResponse = await client.send(
      new ListObjectsV2Command({
        Bucket: config.s3Bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    const keys = (listResponse.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => Boolean(key));

    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: config.s3Bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
    }

    continuationToken = listResponse.IsTruncated ? listResponse.NextContinuationToken : undefined;
  } while (continuationToken);
}

export interface ListedExportObject {
  key: string;
  size: number;
  lastModified: Date;
}

export async function listExportObjects(prefix = "exports/"): Promise<ListedExportObject[]> {
  const client = getS3Client();
  if (!client || !config.s3Bucket) return [];

  const objects: ListedExportObject[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: config.s3Bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of response.Contents ?? []) {
      if (!item.Key || item.Size === undefined || !item.LastModified) continue;
      objects.push({
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified,
      });
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

export async function deleteExportObjects(keys: string[]): Promise<void> {
  const client = getS3Client();
  if (!client || !config.s3Bucket || keys.length === 0) return;

  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: config.s3Bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      }),
    );
  }
}
