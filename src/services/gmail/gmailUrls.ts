import { OAUTH_PUBLIC_PATH } from "../../config";

/** Strip trailing slashes and an optional /trip-planner suffix from PUBLIC_APP_URL. */
export function normalizePublicAppUrl(publicAppUrl: string): string {
  let base = publicAppUrl.trim().replace(/\/+$/, "");
  if (base.endsWith("/trip-planner")) {
    base = base.slice(0, -"/trip-planner".length).replace(/\/+$/, "");
  }
  return base;
}

export function buildOAuthStartUrl(stateId: string, publicAppUrl: string): string {
  const base = normalizePublicAppUrl(publicAppUrl);
  return `${base}${OAUTH_PUBLIC_PATH}/google/start?state=${encodeURIComponent(stateId)}`;
}
