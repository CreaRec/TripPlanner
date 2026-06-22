import type OpenAI from "openai";
import { exportToolsToolDefinitions, exportToolsToolHandlers } from "./export";
import { gmailToolDefinitions, gmailToolHandlers } from "./gmail";
import { placesToolDefinitions, placesToolHandlers } from "./places";
import { providersToolDefinitions, providersToolHandlers } from "./providers";
import { reservationsToolDefinitions, reservationsToolHandlers } from "./reservations";
import { tripToolDefinitions, tripToolHandlers } from "./trip";

export type { AgentContext, ToolHandler } from "./context";

export const toolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  ...tripToolDefinitions,
  ...placesToolDefinitions,
  ...reservationsToolDefinitions,
  ...providersToolDefinitions,
  ...exportToolsToolDefinitions,
  ...gmailToolDefinitions,
];

export const toolHandlers = {
  ...tripToolHandlers,
  ...placesToolHandlers,
  ...reservationsToolHandlers,
  ...providersToolHandlers,
  ...exportToolsToolHandlers,
  ...gmailToolHandlers,
};
