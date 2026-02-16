function normalizePath(value: string): string {
  return value.replace(/\\/g, '/')
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function isWindowsAbsolute(value: string): boolean {
  return /^[a-zA-Z]:\//.test(value)
}

function isPosixAbsolute(value: string): boolean {
  return value.startsWith('/')
}

function splitSegments(value: string): string[] {
  return value.split('/').filter((segment) => segment.length > 0)
}

function computeRelativePath(targetPath: string, basePath: string): string | null {
  const targetNormalized = stripTrailingSlash(normalizePath(targetPath))
  const baseNormalized = stripTrailingSlash(normalizePath(basePath))

  if (!targetNormalized || !baseNormalized) return null
  if (targetNormalized === baseNormalized) return '.'

  const targetIsWindows = isWindowsAbsolute(targetNormalized)
  const baseIsWindows = isWindowsAbsolute(baseNormalized)
  const targetIsPosix = isPosixAbsolute(targetNormalized)
  const baseIsPosix = isPosixAbsolute(baseNormalized)

  if (targetIsWindows !== baseIsWindows) return null
  if (targetIsPosix !== baseIsPosix) return null

  const targetParts = splitSegments(targetNormalized)
  const baseParts = splitSegments(baseNormalized)

  if (targetIsWindows && baseIsWindows) {
    const targetDrive = targetParts[0]?.toLowerCase()
    const baseDrive = baseParts[0]?.toLowerCase()
    if (!targetDrive || !baseDrive || targetDrive !== baseDrive) return null
  }

  let commonIndex = 0
  const maxCommon = Math.min(targetParts.length, baseParts.length)
  while (commonIndex < maxCommon) {
    const targetPart = targetParts[commonIndex]
    const basePart = baseParts[commonIndex]
    const isSame = targetIsWindows
      ? targetPart.toLowerCase() === basePart.toLowerCase()
      : targetPart === basePart
    if (!isSame) break
    commonIndex += 1
  }

  if (commonIndex === 0) return null

  const upLevels = new Array(baseParts.length - commonIndex).fill('..')
  const downLevels = targetParts.slice(commonIndex)
  const relative = [...upLevels, ...downLevels].join('/')
  return relative.length > 0 ? relative : '.'
}

export function toRelativeDisplayPath(pathValue: string, workingDir?: string): string {
  if (!pathValue) return pathValue

  const trimmed = pathValue.trim()
  if (!trimmed) return pathValue

  if (trimmed.startsWith('./') || trimmed.startsWith('../')) return trimmed

  if (!workingDir) return normalizePath(trimmed)

  const relative = computeRelativePath(trimmed, workingDir)
  return relative ?? normalizePath(trimmed)
}
