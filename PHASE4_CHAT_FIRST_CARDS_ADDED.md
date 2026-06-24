# Phase 4 Added — Chat-First Card System + Role Inbox

This patch turns the existing Jobrolo card pieces into a more unified chat-first operating shell. It does **not** add another CRM menu layer. The goal is that users keep talking to Jobrolo while structured cards appear in the conversation when action, approval, location confirmation, or field context is needed.

## Added

### Unified Copilot Cards

New file:

- `src/components/jobrolo/copilot-cards.tsx`

Reusable cards:

- `FieldBriefingCard`
- `FieldEventCard`
- `LocationConfirmationCard`
- `InboxActionCard`
- `InboxStack`
- `CopilotCardFromMessage`

These cards are designed to render structured chat metadata such as:

- `field_event`
- `field_briefing`
- `location_confirmation`
- `material_request`
- `issue_report`
- `action_request_decision`
- approval/action requests

### Role Inbox Strip

New file:

- `src/components/jobrolo/copilot-inbox-strip.tsx`

This fetches `/api/field-copilot/inbox` and renders role-routed work directly above the chat.

Examples:

- PM/coordinator sees material requests waiting on approval.
- Supplier sees approved material orders.
- Owner/admin can see action summaries.

### Message Bubble Card Rendering

Updated:

- `src/components/jobrolo/message-bubble.tsx`

Messages with `contextType` / `contextData` now render the matching Copilot card under the message bubble.

### Workspace Message Context Preservation

Updated:

- `src/app/api/workspaces/[id]/messages/route.ts`
- `src/lib/jobs/worker.ts`
- `src/lib/chat-job.ts`
- `src/hooks/use-chat.ts`
- `src/hooks/use-workspace-chat.ts`

Agent responses can now persist and return:

- `contextType`
- `contextData`

This allows the chat UI to render action cards, location cards, and field cards from real conversation messages instead of only plain text.

### Hidden Channel Navigation / Main Chat Preference

Updated:

- `src/app/page.tsx`
- `src/store/workspace-store.ts`

Workspace channel tabs are no longer shown as primary navigation in the main shell. Channels still exist as internal routing lanes, but the user experience is now:

> Talk to Jobrolo. Jobrolo routes the work.

Entering a workspace now defaults to the `main` chat if it exists, instead of whichever chat sorts first.

### Location Confirmation Cards From Uploads

Updated:

- `src/hooks/use-chat.ts`
- `src/hooks/use-workspace-chat.ts`

When `/api/upload` returns a `locationResolution`, the chat shows a location confirmation card so the user can confirm/attach the photo to the likely job.

### Action Request Cards From Field Actions

Updated:

- `src/lib/field-copilot.ts`

When a field quick action creates an `ActionRequest`, Jobrolo now also posts a structured action card to the project workspace chat. This keeps the project thread and the role inbox aligned.

## Product behavior after this phase

The user should not have to navigate between crew/finance/supplier/customer chats. Those channels are infrastructure.

User-facing model:

- Crew talks to their Jobrolo.
- PM/coordinator gets approval cards in their Jobrolo.
- Supplier/purchasing gets order cards in their Jobrolo.
- Owner/admin gets summaries and approvals in their Jobrolo.
- Project timeline and job packet stay the source of truth.

## Still not included

This phase does not add:

- Full SMS/email messaging
- Final signed PDF generation
- Supplier portal polish
- Full customer portal polish
- Template review/builder UI
- Canvassing map merge
- Live tracking

## Build note

Dependencies are not included in the archive. Run locally after extracting:

```bash
npm install
npx prisma generate
npx prisma db push
npx tsc --noEmit
npm run build
```
