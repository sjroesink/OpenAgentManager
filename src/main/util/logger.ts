const PREFIX = '[AgentManager]'

function timestamp(): string {
  return new Date().toISOString()
}

export const logger = {
  info: (msg: string, ...args: unknown[]) => {
    console.log(`${timestamp()} ${PREFIX} [INFO] ${msg}`, ...args)
  },
  warn: (msg: string, ...args: unknown[]) => {
    console.warn(`${timestamp()} ${PREFIX} [WARN] ${msg}`, ...args)
  },
  error: (msg: string, ...args: unknown[]) => {
    console.error(`${timestamp()} ${PREFIX} [ERROR] ${msg}`, ...args)
  },
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env.DEBUG) {
      console.debug(`${timestamp()} ${PREFIX} [DEBUG] ${msg}`, ...args)
    }
  }
}
