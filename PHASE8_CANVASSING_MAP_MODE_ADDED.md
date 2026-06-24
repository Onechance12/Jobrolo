# Phase 8 — Canvassing App Merge / Map Mode

Phase 8 adds the first real canvassing/map mode layer to Jobrolo without turning the product back into a CRM. The goal is still chat-first: reps can use a focused map surface in the field, but canvassing events, lead cards, and conversions route back into Jobrolo conversations, inbox cards, job packets, and project threads.

## What was added

### Canvassing service layer

Added:

- `src/lib/canvassing.ts`

Core functions:

- `startCanvassingSession()`
- `updateCanvassingSession()`
- `getCanvassingMap()`
- `createCanvassingLead()`
- `updateCanvassingLead()`
- `logCanvassingActivity()`
- `convertCanvassingLead()`

This builds on the existing Phase 3.5 schema models:

- `CanvassingSession`
- `CanvassingLead`
- `CanvassingActivity`
- `FieldLocationPing`
- `InboxItem`

No new Prisma models were required in this phase.

## New API routes

Added:

- `GET /api/canvassing/map`
- `GET /api/canvassing/sessions`
- `POST /api/canvassing/sessions`
- `GET /api/canvassing/sessions/[id]`
- `PATCH /api/canvassing/sessions/[id]`
- `GET /api/canvassing/leads/[id]`
- `PATCH /api/canvassing/leads/[id]`
- `POST /api/canvassing/leads/[id]/activity`
- `POST /api/canvassing/leads/[id]/convert`

Updated:

- `GET /api/canvassing/leads`
- `POST /api/canvassing/leads`

The leads API now supports homeowner name, phone, notes, status, GPS location, and metadata.

## New UI

Added:

- `src/components/jobrolo/canvassing-map-mode.tsx`
- `src/app/canvassing/page.tsx`

The map mode supports:

- Start/end canvassing session
- Capture current GPS only when the user taps a button
- Create lead/pin at current location
- Add address/homeowner/phone/notes
- View lead pins on a lightweight map surface
- Log knock/no-answer/interested/follow-up/not-interested activity
- Convert a lead into a Customer + Project + Workspace/job thread
- See session counts and recent activity

This is intentionally a lightweight MVP map surface. It does not add a heavy external map dependency yet.

## Chat-native cards

Updated:

- `src/components/jobrolo/copilot-cards.tsx`

New card handling:

- `canvassing_session`
- `canvassing_lead`
- `canvassing_activity`

Canvassing events can now appear inside the conversation thread as cards rather than requiring users to open separate channel tabs.

## Agent tools

Updated:

- `src/lib/agent/tools-v2.ts`

Added tools:

- `get_canvassing_map`
- `start_canvassing_session`
- `log_canvassing_activity`
- `convert_canvassing_lead_to_project`

Updated:

- `create_canvassing_lead_at_location`

It now uses the richer canvassing service layer and supports homeowner name and phone.

## Sidebar entry point

Updated:

- `src/components/jobrolo/workspace-sidebar.tsx`

Added a `Canvassing` entry point. This is not meant to become a CRM-style module. It is a focused map/work surface used when the conversation needs a spatial view.

## Product behavior

The intended flow is:

1. Rep starts canvassing session.
2. Rep taps `Add pin here` at a house.
3. Jobrolo creates a lead tied to GPS/session/user.
4. Rep logs knock/no answer/interested/follow-up.
5. Interested lead can be converted into a Customer + Project + Workspace.
6. Project thread is created and the conversion is logged to timeline/chat.

## Privacy rules

Phase 8 keeps the location privacy direction:

- No silent continuous tracking.
- GPS is captured only when the user taps actions like `Locate me`, `Add pin here`, or a canvassing activity.
- Live tracking can be added later as an explicit opt-in session feature.

## What still comes later

Not built yet:

- Full external map provider integration
- Territory drawing/polygon assignment
- Rep live tracking dashboard
- Offline queue/sync
- Bulk KML/CSV territory import
- Canvassing route optimization
- Hail swath/target overlay
- Lead-to-mailer export

Those should come after this core canvassing flow compiles and is tested.
