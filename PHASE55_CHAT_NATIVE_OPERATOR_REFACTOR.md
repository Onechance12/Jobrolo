# Phase 5.5 — Chat-Native Operator Refactor + Proactive Briefing

This phase pulls Jobrolo back toward the core product principle: **the chat is the app**.

The backend can still have workspaces, channels, field visits, inbox items, approvals, templates, documents, signatures, and radar insights. But the contractor should experience those as conversation cards in one thread, not as a CRM full of panels and tabs.

## What changed

### 1. Proactive operator service

Added:

- `src/lib/copilot-proactive.ts`
- `POST /api/copilot/proactive`
- `POST /api/projects/[id]/copilot/proactive`

The proactive operator runs when the user opens Jobrolo or opens a project/job thread. It checks useful operational signals and posts concise assistant messages/cards into the active conversation.

It currently checks:

- role-routed inbox items
- open action requests
- today's/upcoming appointments
- pending signature requests
- contractor template reviews
- documents needing review/OCR confirmation
- operations radar insights

If there is nothing urgent, the global chat can receive a simple daily operator greeting instead of a dashboard panel.

## 2. Dedupe / anti-spam

Proactive messages include a `dedupeKey` inside `contextData`.

Examples:

- `inbox:<inboxItemId>`
- `action:<actionRequestId>`
- `appointment:<appointmentId>:<date>`
- `template:<templateId>:<reviewStatus>`
- `signature:<signatureRequestId>:<status>`
- `document_review:<documentId>:<status>`
- `insight:<insightId>:<status>`

Before posting a proactive message, Jobrolo searches recent messages in the same global conversation or project workspace chat. If the same `dedupeKey` already exists within its window, it does not post it again.

This prevents refresh spam while still allowing genuinely new work to surface.

## 3. Cards are now conversation-native

Expanded `src/components/jobrolo/copilot-cards.tsx`.

The message bubble already supported `contextType/contextData`; this phase uses that pattern more aggressively.

New/expanded card renderers include:

- `schedule_event`
- `signature_request`
- `document_review`
- `radar_alert`
- `operator_briefing`
- existing `field_briefing`
- existing `field_event`
- existing `location_confirmation`
- existing `template_review`
- existing `action_request` / `approval_request` / `material_request`

The UI should now prefer:

> assistant message + structured card inside the thread

instead of:

> mounted strip/panel/drawer above or beside the chat

## 4. Surrounding strips/panels deprecated from the main shell

The main app shell no longer mounts these as primary persistent UI around the conversation:

- `CopilotInboxStrip`
- `FieldEntryStrip`
- `RadarPanel`
- `ContextPanel`
- `FieldCopilotDrawer`

Those components can remain as fallback/deep-view building blocks, but they are no longer the main operating model.

The only persistent UI outside the conversation should be:

- sidebar/job list
- header
- chat input

Everything else should appear as messages/cards in the thread when relevant.

## 5. Field Copilot becomes chat-native

The old drawer still exists as a reusable/fallback component, but the main workspace header now posts/forces a field briefing into the current project thread instead of opening a separate field product.

The intended field behavior is:

- same project conversation
- same project timeline
- cards in-thread
- quick actions on schedule/field cards
- no separate field-only thread to reconcile

## 6. Role-aware behavior

The proactive operator considers the signed-in user's role.

Examples:

- crew sees crew-routed work and field actions
- project manager/coordinator sees approvals, schedules, crew issues, and follow-ups
- finance sees finance-routed items
- supplier/purchasing sees supplier/order items
- owner/admin sees high-level escalations and broad routing lanes

Channels still exist as infrastructure, but the normal user should not manually navigate to crew/finance/supplier chats.

## 7. Prompt update

Updated `src/lib/prompts.ts` so the agent is told to use `contextType/contextData` for structured cards in the conversation.

Relevant card types:

- field_briefing
- field_event
- location_confirmation
- action_request
- approval_request
- material_request
- inbox_item
- radar_alert
- template_review
- document_review
- signature_request
- schedule_event
- canvassing_lead
- production_update

## What still remains later

This phase is a refactor/integration pass, not a final polish pass.

Still needed:

- real mobile field-mode layout polish
- stronger location-aware proactive prompts using live GPS on app open
- better full-page fallback editors for complex review tasks
- signed PDF generation
- roof report PDF polish
- canvassing map merge
- email/SMS/push notifications
- production deployment hardening

## Product rule going forward

Before adding a new strip, panel, drawer, or route, ask:

> Could Jobrolo say this in the thread and render a card instead?

If yes, it belongs in the chat.
