const PREFIX = '[AgentManager]'

export const logger = {
  info: (msg: string, ...args: unknown[]) => {
    console.log(`${PREFIX} ${msg}`, ...args)
  },
  warn: (msg: string, ...args: unknown[]) => {
    console.warn(`${PREFIX} ${msg}`, ...args)
  },
  error: (msg: string, ...args: unknown[]) => {
    console.error(`${PREFIX} ${msg}`, ...args)
  },
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env.DEBUG) {
      console.debug(`${PREFIX} ${msg}`, ...args)
    }
  }
}
