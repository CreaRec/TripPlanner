import { beforeEach, describe, expect, it, vi } from "vitest";

const s3Store = vi.hoisted(() => new Map<string, { body: Buffer; contentType: string; metadata?: Record<string, string> }>());

const s3Mocks = vi.hoisted(() => ({
  send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = command.constructor.name;
    const input = command.input;

    if (name === "HeadObjectCommand") {
      const key = input.Key as string;
      const item = s3Store.get(key);
      if (!item) {
        const err = new Error("NotFound");
        err.name = "NotFound";
        throw err;
      }
      return { Metadata: item.metadata ?? {} };
    }

    if (name === "GetObjectCommand") {
      const key = input.Key as string;
      const item = s3Store.get(key);
      if (!item) {
        const err = new Error("NoSuchKey");
        err.name = "NoSuchKey";
        throw err;
      }
      return {
        Body: {
          transformToString: async () => item.body.toString("utf8"),
          transformToByteArray: async () => item.body,
        },
      };
    }

    if (name === "PutObjectCommand") {
      const key = input.Key as string;
      s3Store.set(key, {
        body: Buffer.from(input.Body as Buffer),
        contentType: input.ContentType as string,
        metadata: input.Metadata as Record<string, string> | undefined,
      });
      return {};
    }

    if (name === "ListObjectsV2Command") {
      const prefix = input.Prefix as string;
      const keys = [...s3Store.keys()].filter((key) => key.startsWith(prefix));
      return {
        Contents: keys.map((key) => ({
          Key: key,
          Size: s3Store.get(key)!.body.length,
          LastModified: new Date("2026-06-01T00:00:00Z"),
        })),
        IsTruncated: false,
      };
    }

    if (name === "DeleteObjectsCommand") {
      const objects = (input.Delete as { Objects: { Key: string }[] }).Objects;
      for (const obj of objects) s3Store.delete(obj.Key);
      return {};
    }

    throw new Error(`Unexpected command: ${name}`);
  }),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class S3Client {
    send = s3Mocks.send;
    constructor(_input: Record<string, unknown>) {}
  },
  HeadObjectCommand: class HeadObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  },
  GetObjectCommand: class GetObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  },
  PutObjectCommand: class PutObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  },
  ListObjectsV2Command: class ListObjectsV2Command {
    constructor(public input: Record<string, unknown>) {}
  },
  DeleteObjectsCommand: class DeleteObjectsCommand {
    constructor(public input: Record<string, unknown>) {}
  },
}));

vi.mock("../config", () => ({
  config: {
    dataDir: "/tmp/export-storage-test",
    s3Bucket: "trip-exports",
    awsRegion: "eu-central-1",
  },
  isExportStorageConfigured: () => true,
}));

import {
  EXPORT_FINGERPRINT_METADATA_KEY,
  getCachedExport,
  getCachedGmailExport,
  hashRouteMapInput,
  itineraryExportKey,
  materializeSingleForTelegram,
  resetS3ClientForTests,
  storeExportObject,
  storeGmailExportManifest,
} from "./exportStorage";

describe("exportStorage", () => {
  beforeEach(() => {
    s3Store.clear();
    s3Mocks.send.mockClear();
    resetS3ClientForTests();
  });

  it("builds deterministic cache keys", () => {
    expect(itineraryExportKey(7, "pdf")).toBe("exports/itinerary/7/export.pdf");
    expect(hashRouteMapInput({
      origin: "A",
      destination: "B",
      stopName: "C",
      baseEncodedPolyline: "base",
      detourEncodedPolyline: "detour",
    })).toHaveLength(64);
  });

  it("returns null on cache miss", async () => {
    await expect(getCachedExport("exports/itinerary/1/export.pdf")).resolves.toBeNull();
  });

  it("matches cached export when fingerprint matches", async () => {
    await storeExportObject("exports/itinerary/1/export.pdf", Buffer.from("pdf"), "application/pdf", {
      fingerprint: "abc123",
    });

    await expect(
      getCachedExport("exports/itinerary/1/export.pdf", { expectedFingerprint: "abc123" }),
    ).resolves.toEqual({ key: "exports/itinerary/1/export.pdf", fingerprint: "abc123" });

    await expect(
      getCachedExport("exports/itinerary/1/export.pdf", { expectedFingerprint: "stale" }),
    ).resolves.toBeNull();
  });

  it("materializes S3 objects to local temp files", async () => {
    await storeExportObject("exports/itinerary/1/export.pdf", Buffer.from("pdf-bytes"), "application/pdf");
    const path = await materializeSingleForTelegram("exports/itinerary/1/export.pdf");
    expect(path).toContain("exports_itinerary_1_export.pdf");
  });

  it("reads gmail export manifests", async () => {
    await storeGmailExportManifest(2, "msg-1", {
      pdfKey: "exports/gmail/2/msg-1/message.pdf",
      attachmentKeys: ["exports/gmail/2/msg-1/attachments/ticket.pdf"],
      skippedAttachments: [],
      subject: "Hotel",
      from: "hotel@example.com",
      date: null,
    });

    const cached = await getCachedGmailExport(2, "msg-1");
    expect(cached?.manifest.subject).toBe("Hotel");
    expect(cached?.keys).toEqual([
      "exports/gmail/2/msg-1/message.pdf",
      "exports/gmail/2/msg-1/attachments/ticket.pdf",
    ]);
  });

  it("treats AccessDenied on cache lookup as a cache miss", async () => {
    s3Mocks.send.mockImplementationOnce(async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === "HeadObjectCommand") {
        const err = new Error("AccessDenied");
        err.name = "AccessDenied";
        throw err;
      }
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    });

    await expect(getCachedExport("exports/itinerary/1/export.pdf")).resolves.toBeNull();
  });

  it("stores fingerprint metadata under the expected key", async () => {
    await storeExportObject("exports/itinerary/9/export.csv", "a,b", "text/csv", {
      fingerprint: "fp-1",
    });
    const item = s3Store.get("exports/itinerary/9/export.csv");
    expect(item?.metadata?.[EXPORT_FINGERPRINT_METADATA_KEY]).toBe("fp-1");
  });
});
