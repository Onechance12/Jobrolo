// Test what models are available and which produces cleanest JSON.

import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  const ai = await ZAI.create()

  // Try non-streaming first to see if model returns clean JSON
  console.log('--- Test: non-streaming with strict JSON instructions ---')
  const res: any = await ai.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: `You are Jobrolo, an AI operations assistant.

You MUST respond with a single valid JSON object. The JSON must have these exact keys:
- "text" (string): your reply
- "actions" (array): list of action objects, can be empty []

Example valid response:
{"text": "Got it.", "actions": []}

Example with action:
{"text": "Noted.", "actions": [{"type": "task", "title": "Replace OSB"}]}

Do NOT include any text before or after the JSON. Do NOT use markdown code fences.`,
      },
      { role: 'user', content: 'Hello, what can you do?' },
    ],
    temperature: 0.3,
    max_tokens: 200,
  })

  console.log('Response:')
  console.log(res.choices?.[0]?.message?.content)
  console.log('---')
}

main().catch(console.error)
