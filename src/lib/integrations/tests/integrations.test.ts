import { getAllIntegrationReadiness, getIntegrationReadiness, getIntegrationsByCapability, INTEGRATIONS } from '../registry'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

export function assertIntegrationRegistryContracts() {
  const ids = new Set<string>()
  for (const integration of INTEGRATIONS) {
    assert(!ids.has(integration.id), `duplicate integration id ${integration.id}`)
    ids.add(integration.id)
    assert(integration.ownerFacingUse.length > 20, `${integration.id} should explain owner-facing use`)
    assert(integration.currentFallback.length > 20, `${integration.id} should have a fallback`)
    assert(integration.safetyRules.length > 0, `${integration.id} should include safety rules`)
  }

  const openai = getIntegrationReadiness('openai')
  assert(Boolean(openai), 'OpenAI integration should be registered')
  assert(openai!.capabilities.includes('web_search'), 'OpenAI should advertise web_search capability')

  const abc = getIntegrationReadiness('abc_supply')
  assert(Boolean(abc), 'ABC Supply integration should be registered')
  assert(abc!.status === 'planned', 'ABC Supply should remain planned until real credentials/provider contract exists')
  assert(abc!.safetyRules.some(rule => /approval/i.test(rule)), 'ABC Supply ordering should require approval')

  const orderProviders = getIntegrationsByCapability('material_order')
  assert(orderProviders.some(provider => provider.id === 'abc_supply'), 'material_order should include ABC Supply')
  assert(orderProviders.every(provider => provider.risk === 'external_purchase'), 'material order providers should be high-risk external purchase integrations')

  const readiness = getAllIntegrationReadiness()
  assert(readiness.length === INTEGRATIONS.length, 'readiness should cover every integration')

  return true
}

if (process.argv[1]?.endsWith('integrations.test.ts')) {
  assertIntegrationRegistryContracts()
  console.log('integration registry contracts passed')
}
