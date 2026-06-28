import { classifyUploadForSkills, buildSkillRoutingContext } from './context'
import { selectSkills } from './select-skill'

export const skillRoutingFixtures = [
  {
    name: 'price sheet routes company pricing',
    input: { filename: 'SUPPLIER_PRICE_LIST_2026.pdf', mimeType: 'application/pdf' },
    expectedStorageScope: 'company_pricing',
    expectedFileType: 'price_sheet',
    expectedSkill: 'price-list',
  },
  {
    name: 'estimate template routes company template',
    input: { filename: 'Roofing estimate template.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    expectedStorageScope: 'company_template',
    expectedSkill: 'template-intake',
  },
  {
    name: 'xactimate estimate routes project file',
    input: { filename: 'Smith Xactimate estimate.pdf', mimeType: 'application/pdf' },
    expectedStorageScope: 'project_file',
    expectedSkill: 'save-scope',
  },
  {
    name: 'company logo routes brand asset',
    input: { filename: 'logo.png', mimeType: 'image/png', suggestedUploadPurpose: 'company_logo' },
    expectedStorageScope: 'brand_asset',
    expectedFileType: 'company_logo',
    expectedSkill: 'brand-assets',
  },
] as const

export function assertSkillRoutingFixtures() {
  for (const fixture of skillRoutingFixtures) {
    const classification = classifyUploadForSkills(fixture.input)
    if (classification.storageScope !== fixture.expectedStorageScope) {
      throw new Error(`${fixture.name}: expected ${fixture.expectedStorageScope}, got ${classification.storageScope}`)
    }
    if ('expectedFileType' in fixture && classification.fileType !== fixture.expectedFileType) {
      throw new Error(`${fixture.name}: expected fileType ${fixture.expectedFileType}, got ${classification.fileType}`)
    }
    const skills = selectSkills(buildSkillRoutingContext({ latestText: '', upload: fixture.input })).map(selection => selection.skill.id)
    if (!skills.includes(fixture.expectedSkill)) {
      throw new Error(`${fixture.name}: expected skill ${fixture.expectedSkill}, got ${skills.join(', ')}`)
    }
  }
}
