import { detectUserState } from './detect-user-state'
import type { BuildBrainContextInput } from './types'

export function buildBrainContext(input: BuildBrainContextInput) {
  return detectUserState(input)
}
