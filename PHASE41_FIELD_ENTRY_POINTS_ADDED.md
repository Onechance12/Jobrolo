# Phase 4.1 — Field Entry Points + Navigation Cleanup

This patch builds on Phase 4's chat-first card system. It does not add another CRM-style module. It connects the Field Copilot engine to the main chat experience so users can start field work from the current job instead of typing raw project IDs or navigating channel tabs.

## What changed

### Main chat now has job-site entry points

When the user is inside a project workspace, the conversation shows a Field-ready strip above the chat/inbox area.

It includes:

- Brief me
- I'm here
- Next steps
- Photos
- Need material
- Signing
- Production

The user can act from the chat-first shell instead of opening a separate CRM page.

### Field Copilot drawer opens from the current job

The main workspace header now includes a Field button when the active workspace has a projectId. This opens the Field Copilot drawer directly for the current project.

### Arrival can be logged in one tap

The I'm here quick action attempts to capture browser GPS, posts to:

`POST /api/projects/[id]/field-copilot/actions`

and logs the arrival through the existing Field Copilot action executor. A field event card is then added to the active workspace thread.

### The old dev Field Copilot page was cleaned up

`/field-copilot` no longer starts with a raw project ID input. It now loads project workspaces from `/api/workspaces`, lets the user search/select a job, and opens the same Field Copilot drawer used by the main chat.

### Sidebar language is less CRM-like

Project workspace rows now say `Job thread` instead of exposing the number of underlying channels. Channels still exist as routing infrastructure, but they are no longer presented as the primary user mental model.

## Files added

- `src/components/jobrolo/field-entry-strip.tsx`
- `PHASE41_FIELD_ENTRY_POINTS_ADDED.md`

## Files updated

- `src/app/page.tsx`
- `src/app/field-copilot/page.tsx`
- `src/components/jobrolo/workspace-sidebar.tsx`

## Product rule preserved

Field Copilot is still not a separate source of truth.

It is a field-facing mode/drawer that writes to:

- FieldVisit
- ProjectTimelineEvent
- workspace event cards
- role inbox/action cards
- job packet links where relevant

The user experience is still: talk to Jobrolo, tap the right card/button, and let Jobrolo route the work.
