import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const jiti = require('jiti')(process.cwd(), { interopDefault: true })

const { assertSkillRoutingFixtures } = jiti('./src/lib/skills/routing-fixtures.ts')
const { assertSkillRoutingContracts } = jiti('./src/lib/skills/tests/skill-routing.test.ts')
const { assertMultiSkillOrchestrationContracts } = jiti('./src/lib/skills/tests/multi-skill-orchestration.test.ts')
const { assertCodyPacketContracts } = jiti('./src/lib/cody/tests/cody-packet.test.ts')

assertSkillRoutingFixtures()
assertSkillRoutingContracts()
assertMultiSkillOrchestrationContracts()
assertCodyPacketContracts()
console.log('skill routing contracts passed')
