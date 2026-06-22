import { isGmailOAuthConfigured } from "../../config";
import { startConnectFlow } from "../../http/server";
import {
  disconnectAccount,
  getAccountByEmail,
  getAccountById,
  listAccounts,
} from "../../services/gmail/gmailAccounts";
import { buildGmailSearchQuery } from "../../services/gmail/gmailSearchQuery";
import { searchGmailAccounts } from "../../services/gmail/gmailSearch";
import { saveGmailSearchSession } from "../../services/gmail/gmailSearchSession";
import { buildGmailExportInstruction, exportGmailMessageToPdf } from "../../services/gmail/gmailExport";
import { getPlace } from "../../services/places/places";
import { getTrip } from "../../services/trip/trips";
import { listReservations } from "../../services/reservations/reservations";
import type OpenAI from "openai";
import type { ToolHandler } from "./context";
import { requireConfirmation, requireInteger } from "./helpers";

const GMAIL_CONNECT_HINT = 'Say "подключить почту" or "connect gmail" in Telegram.';

export const gmailToolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "start_gmail_connect",
      description:
        "Start Gmail OAuth and return a one-time link to connect another inbox. Use when the user wants to add, connect, or link a Gmail account or mailbox.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_gmail_accounts",
      description:
        "List Gmail inboxes connected to this user. Use when the user asks which mailboxes are linked.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "disconnect_gmail_account",
      description:
        "Disconnect a linked Gmail inbox. Only call after the user explicitly confirms disconnection. Identify the exact google_email or gmail_account_id first.",
      parameters: {
        type: "object",
        properties: {
          gmail_account_id: { type: "integer", description: "Connected Gmail account id." },
          google_email: { type: "string", description: "Connected Gmail address." },
          confirmed: { type: "boolean", description: "Must be true after explicit user confirmation." },
        },
        required: ["confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_gmail",
      description:
        "Search connected Gmail accounts for travel-related emails (bookings, confirmations, trip details). Searches all connected inboxes unless gmail_account_id or google_email filters to one. Use when the user asks to find emails for a trip, reservation, or place.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional raw Gmail search query to combine with trip/reservation/place context.",
          },
          trip_id: {
            type: "integer",
            description: "Trip to build search terms from. Defaults to the active trip.",
          },
          reservation_id: {
            type: "integer",
            description: "Reservation/booking to build search terms from.",
          },
          place_id: {
            type: "integer",
            description: "Trip place to build search terms from.",
          },
          gmail_account_id: {
            type: "integer",
            description: "Search only this connected Gmail account.",
          },
          google_email: {
            type: "string",
            description: "Search only this connected Gmail address.",
          },
          max_results: {
            type: "integer",
            description: "Maximum messages to return across all searched accounts (default 10, max 20).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "export_gmail_message",
      description:
        "Export a Gmail message to a PDF file (renders HTML with inline images) and send separate file attachments from the email. Use when the user asks to read, show, open, or export a specific email found via search_gmail. Requires gmail_account_id and message_id from search results. Cached exports are reused unless force_refresh is true.",
      parameters: {
        type: "object",
        properties: {
          gmail_account_id: {
            type: "integer",
            description: "Connected Gmail account id from search_gmail results.",
          },
          message_id: {
            type: "string",
            description: "Gmail message id from search_gmail results.",
          },
          force_refresh: {
            type: "boolean",
            description: "Re-fetch from Gmail and regenerate even if a cached export exists.",
          },
        },
        required: ["gmail_account_id", "message_id"],
      },
    },
  },
];

export const gmailToolHandlers: Record<string, ToolHandler> = {
  async start_gmail_connect(ctx) {
    if (!isGmailOAuthConfigured()) {
      return {
        ok: false,
        error: "gmail_oauth_not_configured",
        connect_hint: "Gmail OAuth is not configured on the server.",
      };
    }

    const connectUrl = await startConnectFlow(ctx.telegramId);
    return {
      ok: true,
      connect_url: connectUrl,
      instruction:
        "Reply with connect_url on its own line. Explain the user must open it in a browser, sign in with Google, and allow access. The link expires in about 10 minutes. OAuth connects whichever Google account they sign in with (it may differ from an address they typed).",
    };
  },

  async list_gmail_accounts(ctx) {
    if (!isGmailOAuthConfigured()) {
      return {
        ok: false,
        error: "gmail_oauth_not_configured",
        connect_hint: "Gmail OAuth is not configured on the server.",
      };
    }

    const accounts = await listAccounts(ctx.telegramId);
    return {
      ok: true,
      accounts: accounts.map((a) => ({
        gmail_account_id: a.id,
        google_email: a.googleEmail,
        status: a.status,
        connected_at: a.connectedAt.toISOString(),
      })),
    };
  },

  async disconnect_gmail_account(ctx, args) {
    requireConfirmation(args);

    const hasId = args.gmail_account_id !== undefined;
    const hasEmail = typeof args.google_email === "string" && args.google_email.trim();
    if (!hasId && !hasEmail) {
      throw new Error("Provide gmail_account_id or google_email to disconnect.");
    }
    if (hasId && hasEmail) {
      throw new Error("Provide only one of gmail_account_id or google_email.");
    }

    const identifier = hasId
      ? { id: requireInteger(args.gmail_account_id, "gmail_account_id") }
      : { googleEmail: String(args.google_email).trim() };

    const account =
      identifier.id !== undefined
        ? await getAccountById(ctx.telegramId, identifier.id)
        : await getAccountByEmail(ctx.telegramId, identifier.googleEmail!);

    if (!account) {
      throw new Error("Gmail account not found.");
    }

    const ok = await disconnectAccount(ctx.telegramId, identifier);
    return { ok, google_email: account.googleEmail };
  },

  async search_gmail(ctx, args) {
    if (!isGmailOAuthConfigured()) {
      return {
        ok: false,
        error: "gmail_oauth_not_configured",
        connect_hint: "Gmail OAuth is not configured on the server.",
      };
    }

    const activeAccounts = await listAccounts(ctx.telegramId, { activeOnly: true });
    if (activeAccounts.length === 0) {
      return {
        ok: false,
        error: "gmail_not_connected",
        connect_hint: GMAIL_CONNECT_HINT,
      };
    }

    let accounts = activeAccounts;
    if (args.gmail_account_id !== undefined) {
      const account = await getAccountById(ctx.telegramId, requireInteger(args.gmail_account_id, "gmail_account_id"));
      if (!account || account.status !== "active") {
        throw new Error(`Gmail account ${args.gmail_account_id} not found or inactive.`);
      }
      accounts = [account];
    } else if (typeof args.google_email === "string" && args.google_email.trim()) {
      const account = await getAccountByEmail(ctx.telegramId, args.google_email.trim());
      if (!account || account.status !== "active") {
        throw new Error(`Gmail account ${args.google_email} not found or inactive.`);
      }
      accounts = [account];
    }

    const tripId =
      args.trip_id !== undefined
        ? requireInteger(args.trip_id, "trip_id")
        : ctx.activeTripId;
    const trip = tripId !== null ? await getTrip(ctx.telegramId, tripId) : null;
    if (args.trip_id !== undefined && !trip) {
      throw new Error(`Trip ${args.trip_id} not found.`);
    }

    let reservation = null;
    if (args.reservation_id !== undefined) {
      const reservationId = requireInteger(args.reservation_id, "reservation_id");
      const tripForReservation = tripId ?? ctx.activeTripId;
      if (tripForReservation === null) {
        throw new Error("No active trip for reservation lookup.");
      }
      const reservations = await listReservations(tripForReservation);
      reservation = reservations.find((r) => r.id === reservationId) ?? null;
      if (!reservation) {
        throw new Error(`Reservation ${reservationId} not found.`);
      }
    }

    let place = null;
    if (args.place_id !== undefined) {
      const placeTripId = tripId ?? ctx.activeTripId;
      if (placeTripId === null) {
        throw new Error("No active trip for place lookup.");
      }
      place = await getPlace(placeTripId, requireInteger(args.place_id, "place_id"));
      if (!place) {
        throw new Error(`Place ${args.place_id} not found.`);
      }
    }

    const queryUsed = buildGmailSearchQuery({
      userQuery: typeof args.query === "string" ? args.query : null,
      trip,
      reservation,
      place,
    });
    if (!queryUsed) {
      throw new Error("Could not build a Gmail search query. Provide query text or trip/reservation/place context.");
    }

    const maxResults = Math.min(
      20,
      Math.max(1, args.max_results !== undefined ? requireInteger(args.max_results, "max_results") : 10),
    );

    const searchResult = await searchGmailAccounts(accounts, {
      q: queryUsed,
      maxResults,
    });
    saveGmailSearchSession(ctx.telegramId, searchResult);

    return {
      ok: true,
      ...searchResult,
      instruction:
        "Summarize the matching messages as a numbered list (subject, sender, date, snippet, account_email). Do not include Gmail links. If the user asks for a message by number from the last search, call export_gmail_message with that message's gmail_account_id and message_id from the cached search context — do not call search_gmail again.",
    };
  },

  async export_gmail_message(ctx, args) {
    if (!isGmailOAuthConfigured()) {
      return {
        ok: false,
        error: "gmail_oauth_not_configured",
        connect_hint: "Gmail OAuth is not configured on the server.",
      };
    }

    const account = await getAccountById(
      ctx.telegramId,
      requireInteger(args.gmail_account_id, "gmail_account_id"),
    );
    if (!account || account.status !== "active") {
      throw new Error(`Gmail account ${args.gmail_account_id} not found or inactive.`);
    }

    const messageId =
      typeof args.message_id === "string" && args.message_id.trim()
        ? args.message_id.trim()
        : null;
    if (!messageId) {
      throw new Error("message_id is required.");
    }

    const exported = await exportGmailMessageToPdf(account, messageId, {
      forceRefresh: Boolean(args.force_refresh),
    });
    ctx.exports.push(exported.filePath, ...exported.attachmentFiles);

    return {
      ok: true,
      account_email: account.googleEmail,
      subject: exported.subject,
      from: exported.from,
      date: exported.date,
      format: "pdf",
      file: exported.filePath,
      attachment_files: exported.attachmentFiles,
      skipped_attachments: exported.skippedAttachments,
      cached: exported.cached,
      instruction: buildGmailExportInstruction(
        exported.skippedAttachments,
        exported.attachmentFiles.length,
      ),
    };
  },
};
