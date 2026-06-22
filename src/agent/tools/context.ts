export interface AgentContext {
  telegramId: number;
  activeTripId: number | null;
  /** File paths generated this turn (exports), to be delivered by the bot. */
  exports: string[];
}

export type ToolHandler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<unknown>;
