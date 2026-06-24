// Multi-agent orchestrator — the AI decomposes complex requests into a task plan,
// delegates each task to a specialized sub-agent or tool, executes them (parallel
// where possible), and combines the results.
//
// This replaces the simple agent loop for complex multi-step requests.
// For simple questions, it falls back to a direct response.
//
// Flow:
// 1. AI receives user message + context
// 2. AI decides: simple (respond directly) or complex (create task plan)
// 3. If complex: AI produces a JSON task plan with dependencies
// 4. Orchestrator executes tasks in dependency order (parallel when possible)
// 5. Each task completion sends a progress event to the UI
// 6. After all tasks complete, AI synthesizes results into final response

import { db } from './db'
import { chatComplete, type ChatMessage } from './ai'
import { executeTool, TOOL_DEFINITIONS } from './tools'
import { executeActions } from './actions'
import { logActivity, ACTIVITY_TYPES } from './activity'
import { parseAIResponse } from './prompts'
import type { AiAction, ChannelType } from './types'

// ─── Task types ────────────────────────────────────────────────────────────────
export interface Task {
  id: string
  type: string // read_document | create_customer | create_project | etc.
  description: string // human-readable what this task does
  tool?: string // which tool to call
  args?: Record<string, unknown> // tool args (may be filled by AI or by dependent tasks)
  dependsOn: string[] // task IDs that must complete first
  result?: unknown // filled after execution
  status?: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  error?: string
}

export interface TaskPlan {
  tasks: Task[]
  reasoning: string // why the AI chose this plan
}

export interface OrchestratorResult {
  finalText: string
  taskPlan: TaskPlan | null
  taskResults: Array<{ task: Task; success: boolean; summary: string }>
  actionResults: Array<{ action: string; status: string; detail: string; targetChatType?: string }>
  attachments: Array<{ type: string; name: string; url: string; thumbnailUrl?: string; documentId?: string }>
  thinking: Array<{
    text: string
    toolCalls?: Array<{ name: string; args: Record<string, unknown> }>
    toolResults?: Array<{ name: string; success: boolean; summary: string }>
  }>
}

export interface OrchestratorOptions {
  messages: ChatMessage[]
  contractorId: string
  onProgress?: (event: OrchestratorProgress) => void
  maxIterations?: number
}

export type OrchestratorProgress =
  | { type: 'planning'; text: string }
  | { type: 'task_started'; taskId: string; description: string }
  | { type: 'task_completed'; taskId: string; success: boolean; summary: string }
  | { type: 'synthesizing'; text: string }
  | { type: 'thinking'; text: string; toolCalls?: Array<{ name: string; args: Record<string, unknown> }>; toolResults?: Array<{ name: string; success: boolean; summary: string }> }

// ─── Main orchestrator ─────────────────────────────────────────────────────────
export async function runOrchestrator(opts: OrchestratorOptions): Promise<OrchestratorResult> {
  const { messages, contractorId, onProgress, maxIterations = 10 } = opts

  // Step 1: Ask AI to plan the approach
  // NOTE: Only pass the user's last message — NOT the full conversation history
  // (which includes the Command Center prompt that teaches a different format).
  onProgress?.({ type: 'planning', text: 'Let me figure out the best approach...' })

  const userMessage = messages[messages.length - 1]?.content || ''
  const planResponse = await chatComplete(
    [
      {
        role: 'system',
        content: ORCHESTRATOR_PLANNER_PROMPT,
      },
      {
        role: 'user',
        content: userMessage,
      },
    ],
    { temperature: 0.2, maxTokens: 2000 }
  )

  const plan = parseTaskPlan(planResponse)

  // If no tasks → simple response, fall back to direct AI answer
  if (!plan || plan.tasks.length === 0) {
    onProgress?.({ type: 'thinking', text: 'Let me respond directly.' })

    const directResponse = await chatComplete(
      [
        ...messages.slice(0, -1), // system + history
        {
          role: 'user',
          content: `User asked: "${messages[messages.length - 1].content}". Respond directly and helpfully. If you need to look something up, say what you need.`,
        },
      ],
      { temperature: 0.4, maxTokens: 800 }
    )

    const parsed = parseAIResponse(directResponse)
    return {
      finalText: parsed.text || directResponse,
      taskPlan: null,
      taskResults: [],
      actionResults: [],
      attachments: parsed.attachments ?? [],
      thinking: [],
    }
  }

  // Step 2: Execute the task plan
  onProgress?.({ type: 'planning', text: `I'll handle this in ${plan.tasks.length} step${plan.tasks.length !== 1 ? 's' : ''}.` })

  const taskResults: OrchestratorResult['taskResults'] = []
  const completedTasks = new Map<string, Task>()
  const thinking: OrchestratorResult['thinking'] = []

  // Execute tasks in dependency order
  while (completedTasks.size < plan.tasks.length) {
    // Find tasks whose dependencies are all met
    const ready = plan.tasks.filter(
      (t) =>
        !completedTasks.has(t.id) &&
        t.dependsOn.every((dep) => completedTasks.has(dep))
    )

    if (ready.length === 0) {
      // Deadlock — no tasks are ready but not all completed
      console.warn('[orchestrator] deadlock — marking remaining as failed')
      for (const t of plan.tasks) {
        if (!completedTasks.has(t.id)) {
          completedTasks.set(t.id, { ...t, status: 'failed', error: 'Deadlock' })
        }
      }
      break
    }

    // Execute ready tasks in parallel
    const results = await Promise.all(
      ready.map(async (task) => {
        onProgress?.({
          type: 'task_started',
          taskId: task.id,
          description: task.description,
        })

        // Fill in args from dependent task results if needed
        const resolvedArgs = resolveTaskArgs(task, completedTasks)

        const result = await executeTask(task, resolvedArgs, contractorId)

        onProgress?.({
          type: 'task_completed',
          taskId: task.id,
          success: result.success,
          summary: result.summary,
        })

        const completedTask: Task = {
          ...task,
          status: result.success ? 'done' : 'failed',
          result: result.data,
          error: result.error,
        }
        completedTasks.set(task.id, completedTask)

        return {
          task: completedTask,
          success: result.success,
          summary: result.summary,
        }
      })
    )

    taskResults.push(...results)
  }

  // Step 3: Synthesize the final response from task results
  onProgress?.({ type: 'synthesizing', text: 'Putting it all together...' })

  // Build a summary of what happened for the AI to synthesize
  // Extract KEY fields from the task result so the AI can reference specific
  // details (customer names, amounts, etc.) without hitting token limits.
  const taskSummary = taskResults
    .map((r) => {
      const resultData = extractKeyResultData(r.task)
      return `Task: ${r.task.description}\nStatus: ${r.success ? 'Success' : 'Failed'}\nSummary: ${r.summary}${r.task.error ? `\nError: ${r.task.error}` : ''}\nResult Data:\n${resultData}`
    })
    .join('\n\n---\n\n')

  const synthesisMessages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are Jobrolo. The user asked a question and you executed a multi-step task plan. Summarize what happened in a natural, concise way. Reference specific data from the task results. If any tasks failed, acknowledge it and suggest next steps. Don't say "let me check" — you already did the work.`,
    },
    {
      role: 'user',
      content: `User's original request: "${messages[messages.length - 1].content}"\n\nTask plan reasoning: ${plan.reasoning}\n\nTask results:\n${taskSummary}\n\nGive the user a clear summary of what you did and what the results are. Include specific details (customer names, amounts, etc.).`,
    },
  ]

  const synthesisResponse = await chatComplete(synthesisMessages, {
    temperature: 0.3,
    maxTokens: 1000,
  })

  const parsedSynthesis = parseAIResponse(synthesisResponse)

  // Extract actions + attachments from the synthesis
  const actions = (parsedSynthesis.actions ?? []) as AiAction[]
  const attachments = parsedSynthesis.attachments ?? []

  // Execute any cross-channel actions
  let actionResults: OrchestratorResult['actionResults'] = []
  if (actions.length > 0) {
    // Find the workspace from the messages context
    // (This is simplified — in practice we'd parse the workspace from the task results)
    actionResults = [] // Actions would be executed here if we had workspace context
  }

  // Log an activity for the orchestrated task
  try {
    const contractor = await db.contractor.findUnique({ where: { id: contractorId } })
    if (contractor) {
      // Try to find a project from the task results
      const customerTask = taskResults.find(
        (r) => r.task.type === 'create_customer' && r.success
      )
      if (customerTask) {
        const customerId = (customerTask.task.result as { id?: string })?.id
        if (customerId) {
          const project = await db.project.findFirst({
            where: { customerId },
          })
          if (project) {
            await logActivity(
              project.id,
              ACTIVITY_TYPES.AI_RECOMMENDATION,
              `AI completed multi-step task: ${plan.tasks.map((t) => t.description).join(', ')}`,
              { source: 'ai', body: parsedSynthesis.text?.slice(0, 500) }
            )
          }
        }
      }
    }
  } catch {
    // best-effort
  }

  return {
    finalText: parsedSynthesis.text || synthesisResponse,
    taskPlan: plan,
    taskResults,
    actionResults,
    attachments,
    thinking,
  }
}

// ─── Task plan parser ──────────────────────────────────────────────────────────
function parseTaskPlan(raw: string): TaskPlan | null {
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/```\s*$/i, '').trim()
  }

  try {
    const parsed = JSON.parse(cleaned)
    if (!parsed.tasks || !Array.isArray(parsed.tasks)) return null

    return {
      reasoning: parsed.reasoning || '',
      tasks: parsed.tasks.map((t: any) => ({
        id: String(t.id),
        type: t.type || 'unknown',
        description: t.description || '',
        tool: t.tool,
        args: t.args || {},
        dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.map(String) : [],
      })),
    }
  } catch {
    return null
  }
}

// ─── Task executor ─────────────────────────────────────────────────────────────
async function executeTask(
  task: Task,
  args: Record<string, unknown>,
  contractorId: string
): Promise<{ success: boolean; data: unknown; summary: string; error?: string }> {
  try {
    // If the task has a tool, execute it
    if (task.tool) {
      const result = await executeTool(task.tool, args, contractorId)

      if (!result.success) {
        return {
          success: false,
          data: null,
          summary: `Failed: ${result.error}`,
          error: result.error,
        }
      }

      // Generate a human-readable summary
      const summary = summarizeToolResult(task.tool, result.data)
      return { success: true, data: result.data, summary }
    }

    // If no tool, this is a "thinking" task — just note it
    return {
      success: true,
      data: null,
      summary: task.description,
    }
  } catch (err) {
    return {
      success: false,
      data: null,
      summary: `Error: ${err instanceof Error ? err.message : 'Unknown'}`,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ─── Resolve task args from dependent task results ─────────────────────────────
function resolveTaskArgs(
  task: Task,
  completedTasks: Map<string, Task>
): Record<string, unknown> {
  const resolved = { ...task.args }

  // Replace any string values that reference a dependent task's result
  // Format: "${task_id.field_name}" → value from that task's result
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === 'string') {
      // Match ${...} patterns anywhere in the string
      const matches = [...value.matchAll(/\$\{([^}]+)\}/g)]
      if (matches.length > 0) {
        let resolvedValue = value
        for (const match of matches) {
          const [taskId, ...fieldPath] = match[1].split('.')
          const depTask = completedTasks.get(taskId)
          if (depTask?.result) {
            let val: unknown = depTask.result
            for (const field of fieldPath) {
              val = (val as Record<string, unknown>)?.[field]
            }
            if (val !== undefined && val !== null) {
              resolvedValue = resolvedValue.replace(match[0], String(val))
            }
          }
        }
        // If the entire string was a single ${...} reference and it resolved,
        // use the raw value (not stringified)
        if (matches.length === 1 && value.trim() === matches[0][0]) {
          const [taskId, ...fieldPath] = matches[0][1].split('.')
          const depTask = completedTasks.get(taskId)
          if (depTask?.result) {
            let val: unknown = depTask.result
            for (const field of fieldPath) {
              val = (val as Record<string, unknown>)?.[field]
            }
            if (val !== undefined && val !== null) {
              resolved[key] = val
              continue
            }
          }
        }
        resolved[key] = resolvedValue
      }
    }
  }

  return resolved
}

// ─── Extract key fields from task result for synthesis ─────────────────────────
// Instead of JSON.stringify the entire result (which can be 18K+ chars),
// extract only the fields the synthesis AI needs to answer the user's question.
function extractKeyResultData(task: Task): string {
  if (!task.result) return 'no data'
  const r = task.result as Record<string, unknown>

  // For document reads — extract claim info, summary, line items, customer info
  if (task.type === 'read_document' || task.tool === 'get_document_content') {
    const parts: string[] = []
    if (r.filename) parts.push(`Filename: ${r.filename}`)
    if (r.aiSummary) parts.push(`Summary: ${r.aiSummary}`)
    if (r.fileType) parts.push(`Type: ${r.fileType}`)

    const extracted = r.extractedData as Record<string, unknown> | undefined
    if (extracted) {
      // Claim info (most important for scope of loss)
      const claimInfo = extracted.claimInfo as Record<string, unknown> | undefined
      if (claimInfo) {
        parts.push(`Claim Info:`)
        if (claimInfo.insured) parts.push(`  Insured: ${claimInfo.insured}`)
        if (claimInfo.property) parts.push(`  Property: ${claimInfo.property}`)
        if (claimInfo.claimNumber) parts.push(`  Claim #: ${claimInfo.claimNumber}`)
        if (claimInfo.policyNumber) parts.push(`  Policy #: ${claimInfo.policyNumber}`)
        if (claimInfo.dateOfLoss) parts.push(`  Date of Loss: ${claimInfo.dateOfLoss}`)
        if (claimInfo.adjuster) parts.push(`  Adjuster/Carrier: ${claimInfo.adjuster}`)
        if (claimInfo.total) parts.push(`  Total RCV: $${claimInfo.total}`)
      }

      // Detected customer
      const customer = extracted.detectedCustomer as Record<string, unknown> | undefined
      if (customer) {
        parts.push(`Detected Customer:`)
        if (customer.name) parts.push(`  Name: ${customer.name}`)
        if (customer.address) parts.push(`  Address: ${customer.address}`)
        if (customer.phone) parts.push(`  Phone: ${customer.phone}`)
        if (customer.email) parts.push(`  Email: ${customer.email}`)
      }

      // Line items summary
      const lineItems = extracted.lineItems as unknown[] | undefined
      if (lineItems && Array.isArray(lineItems)) {
        parts.push(`Line Items (${lineItems.length}):`)
        lineItems.slice(0, 15).forEach((li, i) => {
          const item = li as Record<string, unknown>
          parts.push(
            `  ${i + 1}. ${item.description || 'unknown'} — Qty: ${item.quantity || '?'} ${item.unit || ''} — Total: ${item.total ? '$' + item.total : '?'}`
          )
        })
      }

      // Material items summary
      const materialItems = extracted.materialItems as unknown[] | undefined
      if (materialItems && Array.isArray(materialItems)) {
        parts.push(`Material Items (${materialItems.length}):`)
        materialItems.slice(0, 10).forEach((mi, i) => {
          const item = mi as Record<string, unknown>
          parts.push(
            `  ${i + 1}. ${item.name || 'unknown'} — ${item.unit || 'EA'} @ $${item.unitCost || '?'}`
          )
        })
      }

      // Supplement review
      const supplement = extracted.supplementReview as Record<string, unknown> | undefined
      if (supplement) {
        const opps = supplement.opportunities as unknown[] | undefined
        if (opps && Array.isArray(opps) && opps.length > 0) {
          parts.push(`Supplement Opportunities (${opps.length}):`)
          opps.slice(0, 5).forEach((o, i) => {
            const opp = o as Record<string, unknown>
            parts.push(`  ${i + 1}. ${opp.item || 'unknown'} (${opp.priority || '?'}) — ${opp.reason || ''}`)
          })
        }
      }

      // Material takeoff
      const takeoff = extracted.materialTakeoff as Record<string, unknown> | undefined
      if (takeoff) {
        parts.push(`Material Takeoff: ${JSON.stringify(takeoff)}`)
      }
    }

    // File URL for attaching
    if (r.url) parts.push(`File URL: ${r.url}`)
    if (r.id) parts.push(`Document ID: ${r.id}`)

    return parts.join('\n')
  }

  // For customer creation
  if (task.type === 'create_customer' || task.tool === 'create_customer') {
    const parts: string[] = []
    if (r.name) parts.push(`Name: ${r.name}`)
    if (r.phone) parts.push(`Phone: ${r.phone}`)
    if (r.email) parts.push(`Email: ${r.email}`)
    if (r.address) parts.push(`Address: ${r.address}`)
    if (r.id) parts.push(`Customer ID: ${r.id}`)
    if (r.message) parts.push(`Note: ${r.message}`)
    return parts.join('\n') || 'no data'
  }

  // For material price search
  if (task.tool === 'search_material_prices') {
    const items = r.items as unknown[] | undefined
    if (items && Array.isArray(items)) {
      const parts = [`Found ${r.count || items.length} materials:`]
      items.slice(0, 10).forEach((item, i) => {
        const m = item as Record<string, unknown>
        parts.push(
          `  ${i + 1}. ${m.name || 'unknown'} — ${m.unit || 'EA'} @ $${m.unitCost || '?'}${m.sku ? ` (SKU: ${m.sku})` : ''}`
        )
      })
      return parts.join('\n')
    }
  }

  // For list_documents
  if (task.tool === 'list_documents') {
    const docs = r.documents as unknown[] | undefined
    if (docs && Array.isArray(docs)) {
      const parts = [`Found ${r.count || docs.length} documents:`]
      docs.slice(0, 10).forEach((d, i) => {
        const doc = d as Record<string, unknown>
        parts.push(`  ${i + 1}. ${doc.originalName || 'unknown'} [${doc.fileType || '?'}] — ${(doc.aiSummary as string || '').slice(0, 80)}`)
      })
      return parts.join('\n')
    }
  }

  // For list_photos
  if (task.tool === 'list_photos') {
    const photos = r.photos as unknown[] | undefined
    if (photos && Array.isArray(photos)) {
      const parts = [`Found ${r.count || photos.length} photos:`]
      photos.slice(0, 10).forEach((p, i) => {
        const photo = p as Record<string, unknown>
        parts.push(`  ${i + 1}. ${photo.filename || 'unknown'} — URL: ${photo.url}`)
      })
      return parts.join('\n')
    }
  }

  // For project details
  if (task.tool === 'get_project_details') {
    const parts: string[] = []
    if (r.name) parts.push(`Project: ${r.name}`)
    if (r.project) {
      const p = r.project as Record<string, unknown>
      if (p.title) parts.push(`Title: ${p.title}`)
      if (p.status) parts.push(`Status: ${p.status}`)
      if (p.priority) parts.push(`Priority: ${p.priority}`)
      if (p.value) parts.push(`Value: $${p.value}`)
      if (p.customer) {
        const c = p.customer as Record<string, unknown>
        parts.push(`Customer: ${c.name || 'unknown'}`)
      }
    }
    return parts.join('\n') || 'no data'
  }

  // Fallback — stringify but cap at 1500 chars
  const str = JSON.stringify(r, null, 2)
  return str.length > 1500 ? str.slice(0, 1500) + '\n...(truncated)' : str
}

// ─── Summarize tool result ─────────────────────────────────────────────────────
function summarizeToolResult(toolName: string, data: unknown): string {
  if (!data || typeof data !== 'object') return 'completed'
  const d = data as Record<string, unknown>

  switch (toolName) {
    case 'create_customer':
      return `Created customer: ${d.name}${d.message ? ` — ${d.message}` : ''}`
    case 'search_material_prices':
      return `Found ${d.count || 0} material(s)`
    case 'get_document_content':
      return `Read document: ${d.filename || 'unknown'}`
    case 'list_documents':
      return `Found ${d.count || 0} document(s)`
    case 'list_photos':
      return `Found ${d.count || 0} photo(s)`
    case 'get_project_details':
      return `Got details for: ${d.name || 'project'}`
    case 'search_customers':
      return `Found ${d.count || 0} customer(s)`
    case 'get_workspace_memory':
      return `Retrieved ${d.count || 0} memory entries`
    default:
      return 'completed'
  }
}

// ─── Planner prompt ────────────────────────────────────────────────────────────
const ORCHESTRATOR_PLANNER_PROMPT = `You are Jobrolo's task orchestrator. Your job is to break down the user's request into a plan of tasks that can be executed by tools.

AVAILABLE TOOLS:
${TOOL_DEFINITIONS.map((t) => `- ${t.name}: ${t.description}`).join('\n')}

RULES:
1. If the request is simple (a question, a greeting, a single lookup), return NO tasks — just respond with an empty tasks array. The system will handle it directly.
2. If the request requires multiple steps (e.g., "upload a scope and add the client" → read document → extract customer → create customer → create project), create a task plan.
3. Each task should map to ONE tool call. Include the tool name and args.
4. Use dependsOn to specify task dependencies. Tasks with no dependencies run in parallel.
5. Use "\${task_id.field}" syntax in args to reference results from dependent tasks. Example: {"name": "\${1.name}"} means "use the 'name' field from task 1's result".
6. Be specific about args — fill in what you can from the user's message.

TASK TYPES:
- read_document: { tool: "get_document_content", args: { filename: "scope-of-loss" } }
- create_customer: { tool: "create_customer", args: { name: "...", phone: "...", email: "...", address: "..." } }
- search_materials: { tool: "search_material_prices", args: { query: "..." } }
- list_documents: { tool: "list_documents", args: { fileType: "scope_of_loss" } }
- list_photos: { tool: "list_photos", args: { workspaceName: "Johnson" } }
- get_project: { tool: "get_project_details", args: { workspaceName: "Johnson Reroof" } }
- search_customers: { tool: "search_customers", args: { query: "Sarah" } }

RESPOND AS JSON:
{
  "reasoning": "Why you chose this plan",
  "tasks": [
    {
      "id": "1",
      "type": "read_document",
      "description": "Read the uploaded scope of loss",
      "tool": "get_document_content",
      "args": { "filename": "scope-of-loss" },
      "dependsOn": []
    },
    {
      "id": "2",
      "type": "create_customer",
      "description": "Create customer from scope data",
      "tool": "create_customer",
      "args": {
        "name": "\${1.extractedData.claimInfo.insured}",
        "address": "\${1.extractedData.claimInfo.property}"
      },
      "dependsOn": ["1"]
    }
  ]
}

If the request is simple, return: { "reasoning": "Simple request, no task plan needed.", "tasks": [] }

Return JSON only. No markdown.`
