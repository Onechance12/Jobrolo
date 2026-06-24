# Phase 3.5 Added — Field Copilot + Role Routing + Location Resolver

This patch adds the operational layer discussed after Phase 3 Template Intake.

## Product direction

Jobrolo should not feel like a CRM where users navigate many chats. Each user talks to their own Jobrolo. Jobrolo routes work behind the scenes to the correct role, job packet, project timeline, and approval queue.

Field Copilot is a mobile field-mode drawer/shell. It is not a separate source of truth.

Canonical records remain:

- Project/job packet
- Project timeline
- Workspace/project conversation stream
- Role-routed inbox/action cards

## New Prisma models

Added:

- `FieldVisit`
- `FieldLocationPing`
- `LocationResolution`
- `ActionRequest`
- `ApprovalRequest`
- `InboxItem`
- `CanvassingSession`
- `CanvassingLead`
- `CanvassingActivity`

## New service layer

Added:

- `src/lib/field-copilot.ts`

Core functions:

- `getFieldBriefing()`
- `resolveFieldEntity()`
- `confirmLocationResolution()`
- `executeFieldAction()`
- `listCopilotInbox()`
- `decideActionRequest()`
- `createCanvassingLeadFromLocation()`

## New API routes

Added:

- `GET /api/projects/[id]/field-copilot`
- `POST /api/projects/[id]/field-copilot/actions`
- `POST /api/field-copilot/resolve-location`
- `POST /api/field-copilot/confirm-location`
- `GET /api/field-copilot/inbox`
- `POST /api/action-requests/[id]/decision`
- `GET /api/canvassing/leads`
- `POST /api/canvassing/leads`

## New agent tools

Added to `tools-v2.ts`:

- `get_field_briefing`
- `log_field_action`
- `resolve_field_location`
- `get_copilot_inbox`
- `decide_action_request`
- `create_canvassing_lead_at_location`

Mutation tools require approval when used through chat.

## Upload/location behavior

`POST /api/upload` now accepts optional field context:

- `appointmentId`
- `fieldVisitId`
- `mode`
- `lat` / `lng`
- `accuracyMeters`
- `photoExifLat` / `photoExifLng`

If a photo/file upload has GPS or field visit context but no explicit project, Jobrolo creates a `LocationResolution` and returns the confidence/candidates. High-confidence matches can be confirmed/attached through the resolver flow. This protects the job packet from blind auto-attachment while still making field work fast.

## Field action behavior

A Field Copilot quick action can now do multiple things in one call:

- Create/update `FieldVisit`
- Update appointment status when relevant
- Create `FieldLocationPing`
- Link photo documents to the field visit/job packet
- Create `ProjectTimelineEvent`
- Post compact event cards to the project workspace stream
- Create `ActionRequest` / `ApprovalRequest` / `InboxItem` for routed approvals

Example: `need_material` creates a material request, routes approval to PM/coordinator, logs the project timeline, and can route an approved request to supplier.

## Native Speak Briefing

Added:

- `src/hooks/use-speak-briefing.ts`

This uses browser `speechSynthesis` only. It does not call a paid/server TTS provider. It is user-tap only and redacts obvious claim/financial/private details from spoken text.

## Field UI shell

Added:

- `src/components/jobrolo/field-copilot-drawer.tsx`
- `src/app/field-copilot/page.tsx`

This is a foundation/shell, not final design. The intended production UX is for the drawer to open from the current job/project card inside the main chat-first workspace.

## Important limitations

This phase does not yet include:

- Real map UI
- Full canvassing app merge
- Continuous live GPS tracking
- Offline action queue
- Twilio/SMS/email notifications
- Supplier external portal
- Final polished mobile UI
- True EXIF parsing inside the backend
- Address geocoding for brand-new jobs without existing GPS pins

The resolver is intentionally conservative. It can use explicit project, active field visit, appointment context, browser GPS, photo EXIF values when supplied, saved field pings, and canvassing leads. A real geocoder/map layer should be added when the canvassing app is merged.
