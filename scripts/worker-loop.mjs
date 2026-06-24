#!/usr/bin/env node
const everyMs = Number(process.env.WORKER_INTERVAL_MS || 5000)
while (true) {
  const child = await import('node:child_process')
  await new Promise(resolve => {
    const p = child.spawn(process.execPath, ['scripts/worker-once.mjs'], { stdio: 'inherit', env: process.env })
    p.on('exit', resolve)
  })
  await new Promise(r => setTimeout(r, everyMs))
}
