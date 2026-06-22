# Agent tools

OpenAI function-calling definitions and handlers used by [`runAgent`](../runAgent.ts). Each module mirrors a [`services/`](../services/README.md) domain folder.

Tests: [`tools.test.ts`](../tools.test.ts).

## Module map

| File | Purpose | Example tools |
|------|---------|---------------|
| [`context.ts`](context.ts) | Shared types | `AgentContext`, `ToolHandler` |
| [`helpers.ts`](helpers.ts) | Validation helpers | `requireTrip`, `requireConfirmation`, enum validators |
| [`serializers.ts`](serializers.ts) | Response shaping | `googlePlaceToToolResult`, `savedPlaceToToolResult` |
| [`trip.ts`](trip.ts) | Trips, itinerary, memories | `create_trip`, `get_itinerary`, `save_memory` |
| [`places.ts`](places.ts) | Trip places and saved places | `add_place`, `save_interesting_place`, `suggest_saved_places_on_route` |
| [`reservations.ts`](reservations.ts) | Bookings and re-enrichment | `add_reservation`, `enrich_reservation` |
| [`providers.ts`](providers.ts) | External provider tools | `get_weather` |
| [`export.ts`](export.ts) | Itinerary exports | `export_itinerary` |
| [`gmail.ts`](gmail.ts) | Gmail OAuth, search, export | `search_gmail`, `export_gmail_message` |
| [`index.ts`](index.ts) | Aggregates all domains | `toolDefinitions`, `toolHandlers` |

## Import convention

Import the public API from the folder entry point:

```ts
import { AgentContext, toolDefinitions, toolHandlers } from "./tools";
```

Domain modules export `{domain}ToolDefinitions` and `{domain}ToolHandlers` pairs. Add a new tool by extending the relevant domain file, then wire it in [`index.ts`](index.ts).

## Adding a tool

1. Add the OpenAI schema to `{domain}ToolDefinitions` in the matching domain file.
2. Implement the handler in `{domain}ToolHandlers` in the same file.
3. Reuse shared helpers from [`helpers.ts`](helpers.ts) and serializers from [`serializers.ts`](serializers.ts) where applicable.
4. Call the corresponding function in [`services/`](../services/README.md) — keep business logic in services, not in tool handlers.
