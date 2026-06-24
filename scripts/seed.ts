import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const PROJECT_CHANNELS = ['main', 'customer', 'crew', 'supplier', 'finance', 'management']
const LABELS: Record<string, string> = { main: 'Main', customer: 'Customer', crew: 'Crew', supplier: 'Supplier', finance: 'Finance', management: 'Management' }

async function main() {
  console.log('🌱 Seeding Jobrolo…')
  // Wipe
  for (const m of ['workspaceAction', 'workspaceMemory', 'workspaceMessage', 'workspaceChat', 'workspaceMember', 'workspace', 'task', 'note', 'message', 'conversation', 'document', 'materialItem', 'priceSheet', 'followUp', 'quote', 'estimate', 'inspection', 'project', 'customer', 'subcontractor', 'supplier', 'user', 'contractor', 'projectActivity']) {
    await (db as any)[m].deleteMany()
  }
  const contractor = await db.contractor.create({ data: { name: 'Mike Johnson', email: 'mike@mikesroofing.com', phone: '(555) 100-2000', company: "Mike's Roofing LLC" } })
  const mike = await db.user.create({ data: { contractorId: contractor.id, name: 'Mike Johnson', email: 'mike@mikesroofing.com', role: 'owner' } })
  const customers = await Promise.all([
    { name: 'Sarah Johnson', email: 'sarah.j@gmail.com', phone: '(555) 200-1001', address: '142 Maple Street, Springfield' },
    { name: 'Carlos Martinez', email: 'carlos.m@outlook.com', phone: '(555) 200-1002', address: '88 Oak Avenue, Riverside' },
    { name: 'Emily Thompson', email: 'emily.t@yahoo.com', phone: '(555) 200-1003', address: '3 Birch Lane, Hillcrest' },
    { name: 'David Chen', email: 'david.chen@gmail.com', phone: '(555) 200-1004', address: '215 Cedar Court, Lakeside' },
  ].map(c => db.customer.create({ data: { ...c, contractorId: contractor.id } })))
  const subs = await Promise.all([
    { name: 'Marco Ramirez', company: 'Ramirez Roofing Crew', specialty: 'Shingle installation', phone: '(555) 300-4001' },
    { name: 'Tony Vargas', company: 'Vargas Gutters', specialty: 'Gutters & flashing', phone: '(555) 300-4002' },
  ].map(s => db.subcontractor.create({ data: { ...s, contractorId: contractor.id, status: 'active', rating: 5 } })))
  const supplier = await db.supplier.create({ data: { contractorId: contractor.id, name: 'ABC Roofing Supply', phone: '(555) 400-5000', email: 'orders@abcsupply.com' } })
  const projects = await Promise.all([
    { title: 'Johnson Reroof', customer: customers[0], status: 'active', priority: 'high', value: 18500, address: '142 Maple Street, Springfield' },
    { title: 'Martinez Storm Repair', customer: customers[1], status: 'active', priority: 'urgent', value: 12400, address: '88 Oak Avenue, Riverside' },
    { title: 'Thompson Inspection', customer: customers[2], status: 'active', priority: 'medium', value: 3200, address: '3 Birch Lane, Hillcrest' },
    { title: 'Chen Full Replacement', customer: customers[3], status: 'active', priority: 'high', value: 24800, address: '215 Cedar Court, Lakeside' },
  ].map(p => db.project.create({ data: { contractorId: contractor.id, customerId: p.customer.id, title: p.title, status: p.status, priority: p.priority, address: p.address, value: p.value } })))
  for (const project of projects) {
    const ws = await db.workspace.create({ data: { contractorId: contractor.id, name: project.title, type: 'project', color: 'bg-emerald-500', projectId: project.id } })
    for (const ct of PROJECT_CHANNELS) await db.workspaceChat.create({ data: { workspaceId: ws.id, chatType: ct, title: LABELS[ct] } })
  }
  for (const sub of subs) { const ws = await db.workspace.create({ data: { contractorId: contractor.id, name: sub.company ?? sub.name, type: 'subcontractor', color: 'bg-violet-500', subcontractorId: sub.id } }); for (const ct of ['main', 'supplier']) await db.workspaceChat.create({ data: { workspaceId: ws.id, chatType: ct, title: ct === 'main' ? sub.name : 'Supplier Chat' } }) }
  const sws = await db.workspace.create({ data: { contractorId: contractor.id, name: supplier.name, type: 'supplier', color: 'bg-teal-500', supplierId: supplier.id } })
  for (const ct of ['main', 'supplier']) await db.workspaceChat.create({ data: { workspaceId: sws.id, chatType: ct, title: ct === 'main' ? supplier.name : 'Ordering' } })
  const tasks = [
    { p: projects[0], t: 'Order shingles - GAF Timberline HDZ Charcoal', pr: 'high', s: 'open' },
    { p: projects[0], t: 'Schedule tear-off crew', pr: 'high', s: 'open' },
    { p: projects[0], t: 'Pull permit - City of Springfield', pr: 'medium', s: 'completed' },
    { p: projects[1], t: 'Tarp damaged section', pr: 'urgent', s: 'completed' },
    { p: projects[1], t: 'Coordinate with insurance adjuster', pr: 'high', s: 'in_progress' },
    { p: projects[2], t: 'Roof inspection - document all 4 slopes', pr: 'medium', s: 'open' },
    { p: projects[3], t: 'Order materials - 30sq architectural shingles', pr: 'high', s: 'open' },
  ]
  for (const t of tasks) await db.task.create({ data: { projectId: t.p.id, title: t.t, priority: t.pr, status: t.s, completedAt: t.s === 'completed' ? new Date() : null, createdById: mike.id } })
  const johnsonWs = await db.workspace.findFirst({ where: { name: 'Johnson Reroof', type: 'project' } })
  if (johnsonWs) { await db.workspaceMemory.create({ data: { workspaceId: johnsonWs.id, category: 'key_info', content: 'Customer: Sarah Johnson. Roof: 2-story colonial, ~28 squares.', source: 'system' } }); await db.workspaceMemory.create({ data: { workspaceId: johnsonWs.id, category: 'decision', content: 'Material: GAF Timberline HDZ Charcoal. Underlayment: Tiger Paw.', source: 'system' } }) }
  const convo = await db.conversation.create({ data: { contractorId: contractor.id, title: 'Welcome to Jobrolo' } })
  await db.message.create({ data: { conversationId: convo.id, role: 'assistant', content: "Good morning, Mike. Here's what's on your plate today:\n\n• Johnson Reroof — high priority\n• Martinez Storm Repair — urgent\n• Thompson Inspection — scheduled\n• Chen Full Replacement — high priority\n\nAsk me anything." } })
  console.log('✅ Seed complete.')
}
main().catch(e => { console.error('Seed failed:', e); process.exit(1) }).finally(() => db.$disconnect())
