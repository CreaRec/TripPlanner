import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("docker deploy contract", () => {
  it("docker-compose.yml pulls GHCR bot image and preserves db identity", async () => {
    const compose = await readFile(path.join(repoRoot, "docker-compose.yml"), "utf8");

    expect(compose).toMatch(/container_name:\s*crea-trip-planner-db/);
    expect(compose).toMatch(/\.\/data\/postgres:\/var\/lib\/postgresql\/data/);
    expect(compose).toMatch(/pgvector\/pgvector:pg16/);
    expect(compose).toMatch(/ghcr\.io\/crearec\/crea-trip-planner/);
    expect(compose).toMatch(/IMAGE_TAG/);
    expect(compose).toMatch(/\.\/data\/exports:\/app\/data\/exports/);
    expect(compose).toMatch(/127\.0\.0\.1:\$\{HTTP_PORT:-3000\}:3000/);
    expect(compose).toMatch(/OTEL_EXPORTER_OTLP_ENDPOINT/);
    expect(compose).toMatch(/OTEL_SERVICE_NAME/);
    expect(compose).toMatch(/OTEL_SERVICE_NAMESPACE/);
    expect(compose).toMatch(/lgtm:\s*\n\s*external:\s*true/);
    expect(compose).not.toMatch(/^\s*build:/m);
  });

  it("CI/CD workflow publishes to GHCR and deploys over SSH", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github/workflows/ci-cd.yml"),
      "utf8",
    );

    expect(workflow).toMatch(/packages:\s*write/);
    expect(workflow).toMatch(/packages:\s*read/);
    expect(workflow).toMatch(/NODE_AUTH_TOKEN/);
    expect(workflow).toMatch(/ghcr\.io\/crearec\/crea-trip-planner/);
    expect(workflow).toMatch(/node-version:\s*"24"/);
    expect(workflow).toMatch(/tailscale\/github-action/);
    expect(workflow).toMatch(/tag:ci/);
    expect(workflow).toMatch(/export IMAGE_TAG=/);
    expect(workflow).toMatch(/docker compose pull/);
    expect(workflow).toMatch(/docker compose up -d/);
    expect(workflow).toMatch(/docker-compose\.yml/);
    expect(workflow).toMatch(/telegram-trip-planner/);
    expect(workflow).not.toMatch(/sed -i/);
    expect(workflow).not.toMatch(/scripts\/deploy\.sh/);
  });

  it("Dockerfile uses Node 24 bookworm-slim and GitHub Packages auth for npm ci", async () => {
    const dockerfile = await readFile(path.join(repoRoot, "Dockerfile"), "utf8");

    expect(dockerfile).toMatch(/^FROM node:24-bookworm-slim AS build$/m);
    expect(dockerfile).toMatch(/^FROM node:24-bookworm-slim AS runtime$/m);
    expect(dockerfile).toMatch(/NODE_AUTH_TOKEN/);
    expect(dockerfile).toMatch(/COPY \.npmrc package\.json package-lock\.json/);
  });
});

