import { classifyUploadForSkills, buildSkillRoutingContext } from './context'
import { selectSkills } from './select-skill'

export const skillRoutingFixtures = [
  {
    name: 'price sheet routes company pricing',
    input: {
      filename: 'download.pdf',
      mimeType: 'application/pdf',
      recentUserText: 'Upload this supplier price list.',
      visibleText: 'Supplier Price List SKU item unit price branch account pricing roofing materials',
    },
    expectedStorageScope: 'company_pricing',
    expectedFileType: 'price_sheet',
    expectedSkill: 'price-list',
  },
  {
    name: 'estimate template routes company template',
    input: {
      filename: 'download.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      visibleText: 'Estimate template blank form signature line terms and conditions customer name placeholders',
    },
    expectedStorageScope: 'company_template',
    expectedSkill: 'template-intake',
  },
  {
    name: 'xactimate estimate routes project file',
    input: {
      filename: 'scan.pdf',
      mimeType: 'application/pdf',
      visibleText: 'Xactimate estimate claim number line items RCV ACV depreciation deductible',
      hasProjectContext: true,
    },
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
