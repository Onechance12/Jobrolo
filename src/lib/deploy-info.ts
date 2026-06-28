import pkg from '../../package.json'

type DeployInfo = {
  appVersion: string
  environment: string
  provider: 'render' | 'local'
  commit: string | null
  shortCommit: string | null
  branch: string | null
}

function firstEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]
    if (value && value.trim()) return value.trim()
  }
  return null
}

export function getDeployInfo(): DeployInfo {
  const commit = firstEnv(
    'RENDER_GIT_COMMIT',
    'GIT_COMMIT',
    'COMMIT_SHA',
    'NEXT_PUBLIC_COMMIT_SHA',
  )

  return {
    appVersion: pkg.version,
    environment: process.env.NODE_ENV || 'development',
    provider: process.env.RENDER ? 'render' : 'local',
    commit,
    shortCommit: commit ? commit.slice(0, 7) : null,
    branch: firstEnv('RENDER_GIT_BRANCH', 'GIT_BRANCH', 'BRANCH_NAME'),
  }
}
