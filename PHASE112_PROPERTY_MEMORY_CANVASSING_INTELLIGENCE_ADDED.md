# Phase 11.2 — Property Memory + Canvassing Intelligence

This phase adds the missing neighborhood-memory layer behind Jobrolo canvassing.

## Why this exists

Not every house is a lead, customer, or job. A contractor may knock thousands of doors after a storm and still need to remember property-level facts:

- roof looked new in July 2026
- missing shingles observed on the ridge
- felt paper/tarp visible
- renter answered
- no-soliciting sign
- no answer after two knocks
- homeowner asked for follow-up
- rep saw damage but no conversation happened
- street already worked recently
- this block had good conversations last time

These are property memories. They should survive across reps, sessions, storms, and future canvassing days without forcing every house into the CRM pipeline.

## New models

Added to `prisma/schema.prisma`:

- `PropertyMemory`
- `PropertyObservation`
- `DoorAttempt`
- `StreetMemory`
- `CanvassingGamePlan`

## New service layer

Added:

- `src/lib/property-memory.ts`

Core functions:

- `upsertPropertyMemory()`
- `recordPropertyObservation()`
- `recordDoorAttempt()`
- `getPropertyMemoryContext()`
- `createCanvassingGamePlan()`

## New API routes

Added:

- `GET /api/property-memory`
- `POST /api/property-memory`
- `GET /api/property-memory/[id]`
- `PATCH /api/property-memory/[id]`
- `POST /api/property-memory/[id]/observations`
- `POST /api/property-memory/[id]/attempts`
- `GET /api/canvassing/game-plans`
- `POST /api/canvassing/game-plans`

## Canvassing integration

Updated `src/lib/canvassing.ts` so canvassing work now creates/updates property memory:

- creating a canvassing lead creates/updates a `PropertyMemory`
- canvassing notes become `PropertyObservation` records
- knock/no-answer/interested/follow-up/renter/no-soliciting events become `DoorAttempt` records
- converting a lead updates the property memory to `converted`
- street-level KPIs update through `StreetMemory`

## Agent tools added

Added to `src/lib/agent/tools-v2.ts`:

- `get_property_memory`
- `upsert_property_memory`
- `record_property_observation`
- `record_door_attempt`
- `create_canvassing_game_plan`

These tools are intentionally approval-gated for mutations.

## Chat-native cards

Updated `src/components/jobrolo/copilot-cards.tsx` with cards for:

- `property_memory`
- `property_observation`
- `door_attempt`
- `canvassing_game_plan`

## Product/tone rule

Canvassing intelligence should feel like a partner, not a boss.

Good:

> Want a fresh-hail day, a follow-up day, or an easy-conversation warmup?

Bad:

> You are behind. Go knock Elm Street.

Jobrolo should ask about mindset, energy, and focus, then build a supportive game plan.

## Data/storage guidance

This phase stores property/workflow memory. It should avoid sensitive personal profiling.

Allowed examples:

- roof condition
- visible damage signal
- no-soliciting sign
- renter/vacant/unknown occupancy status when relevant to workflow
- door attempt outcome
- follow-up reason
- property/street coverage history
- photos/doc IDs
- rep/session history

Avoid:

- protected-class assumptions
- personal demographic predictions
- invasive buyer/personality labels
- unverified private personal details

Long-term production notes:

- Use Postgres before real beta scale.
- Add retention/export/delete policies.
- Keep tenant isolation strict by `contractorId`.
- Treat property memory as company operational data, not customer-facing data.
- Add “do not knock/contact” respect logic before automated recommendations.
