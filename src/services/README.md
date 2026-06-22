# Services

Domain modules used by the agent, bot, and HTTP layer. Tests live next to source files.

## Folder map

| Folder | Purpose | Key modules |
|--------|---------|-------------|
| [`trip/`](trip/) | Trip planning core | `trips`, `itinerary`, `memories`, `tripSummaryFormat` |
| [`places/`](places/) | Trip places and saved places | `places`, `savedPlaces`, `placeEnrichment`, `savedPlaceStatus` |
| [`reservations/`](reservations/) | Bookings and enrichment | `reservations`, `reservationEnrichment`, `reservationType`, `externalProvider`, `enrichmentUtils` |
| [`providers/`](providers/) | External API clients | `googlePlaces`, `googleRoutes`, `aviationStack`, `staticMaps`, `weather`, `routeGeometry` |
| [`gmail/`](gmail/) | Gmail OAuth, search, export | `gmailAccounts`, `gmailClient`, `gmailSearch`, `gmailExport`, `oauthState`, `tokenCrypto` |
| [`export/`](export/) | Itinerary PDF/CSV and S3 storage | `export`, `exportStorage`, `exportFormat`, `exportRetention` |
| [`platform/`](platform/) | Shared user/session infra | `users`, `messages` |

## Import convention

Import from the module file directly — there is no barrel `index.ts`:

```ts
import { getTrip } from "../services/trip/trips";
import { listSavedPlaces } from "../services/places/savedPlaces";
import { lookupFlight } from "../services/providers/aviationStack";
```
