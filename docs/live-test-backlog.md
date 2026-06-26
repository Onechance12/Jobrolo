# Jobrolo Live Test Backlog

Last reviewed: 2026-06-25

Patch note: production hardening now routes configured AI/OCR analysis through the OpenAI-compatible provider when available, records internal AI usage, stops silent price-sheet imports, and adds the `get_customer_file`, `import_price_sheet_items`, and `create_scope_from_text` workflows.

## Product north star

Jobrolo should not feel like another CRM. The main chat is the product:

- the CRM
- the production coordinator
- the file manager
- the supplement assistant
- the roof report builder

Menus and modules are secondary support. Users should be able to ask the main chat to create clients, jobs, project chats, customer-facing chats, roofer/subcontractor chats, upload photos/documents, build roof reports, save scopes, import price sheets, create signature requests, save conversations to job files, pull job packets, and review approvals/tasks.

## Log-confirmed wins

- Signup, onboarding, OpenAI-compatible chat, and main chat are working.
- OpenAI-compatible provider is stable in live logs:
  - provider: `openai-compatible`
  - model: `gpt-4o-mini`
  - status: `200`
- Timothy Dison was created successfully from chat.
  - Render logs show `create_customer` executed with `success=true`.
- Timothy can be retrieved from saved database records.
  - Live logs show `search_customers` found Timothy Dison with saved email, phone, and address.
- Upload save-first behavior is partly working.
  - Logs show `[upload] received`, `[upload] saved document`, and `[upload] queued analysis`.
  - Saved upload document IDs observed:
    - `cmqtzjkxw000znp2ee2imvt1y` — `IMG_6999.jpeg`
    - `cmqtzq3lj002dnp2e3hvbm5b7` — `IMG_7035.jpeg`
    - `cmqtzs7sn002vnp2edqv4pf4e` — `TEXAS_DIRECT_RFG_CONTR_PRICE_LIST_03-28-2025.pdf`
    - `cmqu0hpkv00djnp2es39qls10` — `IMG_7050.jpeg`
- The uploaded price sheet did process more than the UI made obvious.
  - Logs show embedded text extraction of 8,181 characters.
  - Logs show 157 material items saved.
- Photo/document analysis jobs are running after upload.

## Log-confirmed root causes and risks

### P0/P1 — Action execution gap

The AI still sometimes narrates operational work without a real tool/action completing the work.

Observed in logs:

- “I’ll retrieve…”
- “Let me proceed with updating…”
- “I will attach…”
- “I’ll get that now.”

Some turns did call read tools, but the system did not always execute the follow-up save/link/import/workflow the assistant implied.

Required rule:

- `done`, `created`, `saved`, `added`, and `updated` must only be used after a successful tool/database result.
- If no tool ran, the assistant must not claim the action was completed.
- If the required tool/workflow does not exist, the assistant must say it cannot save/execute that workflow yet.
- If a tool fails, the assistant must say the action failed and include the safe error.

### P1 — Customer file resolver

Timothy exists in the DB, but “Timothy’s file” was answered through stitched-together `search_customers` plus broad `list_documents`.

That is fragile because documents may be:

- linked to the customer
- linked to a project
- linked to a workspace
- floating/unlinked after upload

Need a dedicated resolver that normalizes “Timothy’s file,” searches name/phone/email/address, resolves a customer ID, and returns customer, projects, documents, photos, notes, tasks, workspace/chats, and nearby unlinked documents.

### P1 — Upload save-first/process-later

Upload saving is working, but the product needs to clearly separate:

1. file saved
2. analysis queued
3. analysis reviewed/failed
4. linked to customer/project
5. rendered/retrievable in chat

The upload request must not depend on AI analysis completing.

### P1 — Photo/document analysis quality

Image analysis is still using the Z-AI SDK path, while main chat uses OpenAI-compatible.

Observed:

- `[doc-worker] ... PASS 1: vision analysis (z-ai SDK)`
- `[doc-worker] ... PASS 2: skipped — OCR provider not configured`
- image confidence around 28–29/100

This explains why uploaded photos/document photos can be saved but poorly understood.

### P1 — Photo display/rendering

Photos are saved and `list_photos` can run, but the assistant may produce markdown/image URLs instead of structured chat attachments/cards.

Required behavior:

```json
{
  "attachments": [
    {
      "type": "image",
      "name": "IMG_7035.jpeg",
      "url": "/api/storage/photos/...",
      "thumbnailUrl": "/api/storage/thumbnails/...",
      "documentId": "..."
    }
  ]
}
```

Never use `https://yourdomain.com/...`.

### P1 — Customer/project/job hierarchy

The system needs reliable linkage:

Customer → Project/Job → Workspace/Thread → Documents/Photos/Timeline

Uploads currently save, but may remain globally/floating unless the user provided a customer/project/workspace ID or the agent later links them.

Needed workflows:

- create_project_for_customer
- get_customer_file
- get_job_packet
- link_document_to_project
- link_photo_to_project
- save_chat_to_project
- list_project_chats

### P1 — Scope/document persistence

When pasted scope text is understood, it still needs a real save workflow.

Needed:

- save_scope_to_project
- create_scope_from_text
- or save pasted text as a `Document`/scope record linked to customer/project

If no project exists, ask to create one first.

### P1 — Price sheet review/import flow

The test price sheet saved 157 material items, but the product did not clearly say what actually saved or ask for replacement confirmation before risky clearing/replacement workflows.

Patch status:

- Auto-import from the document worker is stopped.
- Extracted material rows stay pending on the Document.
- `import_price_sheet_items` imports rows only after explicit confirmation/approval.

Needed:

- row count and confidence
- ask before clearing/replacing material prices
- separate save, extract, review, import
- `[price-sheet]` logs

### P1 — Chat-first workspace UX

Main chat should create and manage:

- project/customer/subcontractor chats
- save chat to project
- open/list project chats
- roof reports
- templates
- signatures
- customer updates

### P1 — Contextual prompt guidance

Static bottom chips are too generic. Chips should insert editable, context-aware prompts rather than navigate into CRM modules.

### P1 — Saved prompt/command menu

Typing `@` or using a quick-action menu should show recommended/saved prompts such as:

- Scope Analysis
- Add Photos to Job
- Start Roof Report
- Review Price Sheet
- Show Job Packet

### P1 — Persistent Action Center

Approvals, failed actions, due tasks, document reviews, photo issues, price sheet review items, unread chats, and signature requests need a persistent “Action Needed” surface in the chat UI.

### P2 — TTS still uses Z-AI

Logs show:

`[tts]: Error: Configuration file not found or invalid. Please create .z-ai-config...`

TTS should be disabled in production unless configured or routed through a configured provider. TTS errors should not pollute logs or affect chat/upload.

Patch status:

- TTS now defaults to disabled unless `TTS_PROVIDER=z-ai` is explicitly configured.
- Missing `.z-ai-config` should no longer pollute production logs by default.

### P2 — Web search provider prep

No safe chat-native web-search workflow is confirmed yet.

Current rule:

- Do not web-search on every message.
- Only use web search when the user asks for current/external information.
- When implemented, route usage through the configured OpenAI-compatible provider or a clearly configured search provider.
- Log usage with purpose `web_search`.

### P2 — Weird extra tool calls

Observed during customer creation:

- `decide_action_request` with an invalid enum value
- `get_project_context` with `projectId: null`

The loop should block invalid/null operational tool calls and force a correction instead of executing nonsense.

### P2 — Saved vs chat-only truthfulness

When user asks “only show what is actually saved,” the agent must query DB tools and not rely on chat memory.

If not saved:

> We discussed this, but I do not see it saved as a record yet.

## Implementation order

### Phase 1 — Trust/action execution

1. Fix AI narrating without tools.
2. Ensure completion language only follows tool success.
3. Add logs for tool execution/failure and narrated-action blocking.
4. Block invalid/null tool calls.
5. Separate saved records from chat-only memory.

### Phase 2 — Customer/job resolver

1. Add reliable customer file resolver.
2. Ensure Timothy-style name/phone/email/address lookups work.
3. Tie retrieval to customerId/projectId.

### Phase 3 — Uploads/photos

1. Save-first/process-later uploads.
2. Batch photo uploads safely.
3. Add upload sections.
4. Render photos as structured attachments/cards.
5. Fix placeholder URL behavior.

### Phase 4 — Documents/scopes/price sheets

1. Document-photo OCR mode.
2. Paste-first intake workflow.
3. Save pasted scope to project.
4. Price sheet review/import workflow.

### Phase 5 — Chat-first workspace UX

1. Create/list/open project and role chats from main chat.
2. Save chats to project.
3. Start roof reports/templates/signatures from chat.

### Phase 6 — Prompt guidance UX

1. Contextual chips.
2. `@` prompt menu.
3. Prompt variables.
4. Save previous message as prompt.
5. Onboarding prompt education.

### Phase 7 — Minimal shell UI

1. Avatar/settings menu.
2. Action-needed bell.
3. Plus button quick actions.

## Live tests after next deploy

1. `Search customers for Timothy.`
2. `Search customers for Dison.`
3. `Search customers for 806-678-0907.`
4. `Only use saved database records. Show me Timothy Dison’s file.`
5. `Create a project chat for Timothy Dison’s hail claim at 12701 Harvest Grove.`
6. `Save this conversation to Timothy Dison’s job file.`
7. Upload one photo to Timothy’s project.
8. `Show me Timothy’s photos.`
9. Paste scope text and say: `Save this scope breakdown to Timothy’s project.`
10. `What needs my approval right now?`
