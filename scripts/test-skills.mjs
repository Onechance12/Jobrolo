import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const jiti = require('jiti')(process.cwd(), { interopDefault: true })

const { assertSkillRoutingFixtures } = jiti('./src/lib/skills/routing-fixtures.ts')
const { assertSkillRegistryContracts } = jiti('./src/lib/skills/tests/skill-registry.test.ts')
const { assertSkillRoutingContracts } = jiti('./src/lib/skills/tests/skill-routing.test.ts')
const { assertMultiSkillOrchestrationContracts } = jiti('./src/lib/skills/tests/multi-skill-orchestration.test.ts')
const { assertCodyPacketContracts } = jiti('./src/lib/cody/tests/cody-packet.test.ts')
const { assertIntegrationRegistryContracts } = jiti('./src/lib/integrations/tests/integrations.test.ts')
const { assertBrainContextContracts } = jiti('./src/lib/brain/tests/brain-context.test.ts')
const { assertFoundationContextContracts } = jiti('./src/lib/brain/tests/foundation-context.test.ts')

assertFoundationContextContracts()
assertBrainContextContracts()
assertSkillRegistryContracts()
assertSkillRoutingFixtures()
assertSkillRoutingContracts()
assertMultiSkillOrchestrationContracts()
assertCodyPacketContracts()
assertIntegrationRegistryContracts()
console.log('skill routing contracts passed')
