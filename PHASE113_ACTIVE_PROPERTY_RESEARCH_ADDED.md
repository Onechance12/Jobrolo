# Phase 11.3 — Active Property Research + Street Game Planner

This phase adds the active/on-demand layer on top of Property Memory.

## Product intent

Jobrolo should not require every neighborhood list to be uploaded before canvassing. Bulk imports still matter, but the primary field experience should also support:

- “I’m approaching this house. Research it.”
- “Who likely owns this property?”
- “Does Jobrolo already know this house?”
- “I want to work Elm Street and Zoe Street today. Build me a plan.”
- “I want easy conversations / follow-ups / fresh hail / old damage / higher-value roof opportunities today.”

The tone should remain a supportive partner riding shotgun, not a boss or surveillance system.

## New schema models

Added:

- `PropertyResearchRun`
- `PropertyResearchCandidate`
- `PropertyEnrichmentSnapshot`
- `StreetResearchRun`

Extended `PropertyMemory` with property enrichment fields:

- possible owner name
- owner mailing address
- parcel/account IDs
- market/assessed/improvement/land values
- sqft/year built/beds/baths/stories
- owner-occupied signal
- last enrichment timestamp/status

## Why research runs are separate from property memory

`PropertyResearchRun` is messy and temporary. It can contain unverified provider data, GPS guesses, imported/cached records, and conflicting matches.

`PropertyMemory` is the long-term clean record. A candidate should only become long-term memory after confidence is high or a human confirms it.

## New service layer

Added:

- `src/lib/property-research.ts`

Core functions:

- `researchPropertyNow()`
- `getPropertyResearchRun()`
- `confirmPropertyResearchCandidate()`
- `getStreetResearchRuns()`

The service uses existing property memory first, then optionally calls a configured provider webhook.

## New API routes

Added:

- `GET /api/property-research`
- `POST /api/property-research`
- `GET /api/property-research/[id]`
- `POST /api/property-research/[id]/confirm`
- `GET /api/canvassing/street-research`
- `POST /api/canvassing/street-research`

## Optional provider configuration

By default this phase does **not** scrape public websites or silently use paid property data.

It supports an external property-data provider/webhook when configured:

```env
PROPERTY_RESEARCH_ENABLED=1
PROPERTY_RESEARCH_WEBHOOK_URL=https://your-property-provider.example.com/research
PROPERTY_RESEARCH_API_KEY=...
```

Expected provider response can contain `candidates` or `properties`, with fields like:

- address
- ownerName
- ownerMailingAddress
- parcelId/countyAccountId
- marketValue/assessedValue
- livingAreaSqft/yearBuilt/bedrooms/bathrooms/stories
- latitude/longitude
- confidence/source/matchReason

## New agent tools

Added:

- `research_property_now`
- `confirm_property_research_candidate`
- `get_property_research_run`
- `research_streets_for_canvassing`
- `get_street_research_runs`

These are intended for chat-native workflows, for example:

> “I’m approaching this house. Research it.”

or:

> “I want to hit Elm Street and Zoe Street today. I’m feeling easy conversations and follow-ups.”

## New chat cards

Added cards in `copilot-cards.tsx` for:

- `property_research_result`
- `street_game_plan`

These show researched candidates, confidence, possible owner/address info, opportunity scores, recommended starts, follow-up candidates, and scripts directly inside the conversation.

## Data/storage guardrails

This can scale to thousands or hundreds of thousands of properties, so the structure keeps data normalized:

- one `PropertyMemory` per house
- many `PropertyObservation` rows over time
- many `DoorAttempt` rows over time
- research attempts stored separately as `PropertyResearchRun`
- provider snapshots stored as `PropertyEnrichmentSnapshot`

Do not store sensitive personal profiling. Keep data property/workflow based:

Good:

- owner name from public/imported record
- owner mailing address
- roof looked new
- visible missing shingles
- renter answered
- no soliciting sign
- follow-up requested
- storm exposure signal
- roof/property opportunity score

Avoid:

- protected-class targeting
- sensitive personal assumptions
- creepy behavioral/personality profiling
- “this type of person buys” language

## What remains later

Still needed later:

- polished Canvassing Partner UI flow
- property-provider connector implementation
- CSV/KML/GeoJSON importer mapping UI
- storm event/weather scoring connector
- street/block coverage visualization
- data retention/export/delete controls
- Postgres indexes/geo indexes for real beta scale
