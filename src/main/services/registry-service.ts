import fs from 'fs'
import type { AcpRegistry } from '@shared/types/agent'
import { ACP_CDN_URL, ACP_REGISTRY_URL, REGISTRY_CACHE_TTL_MS, getAgentIconUrl } from '@shared/constants'
import { getRegistryCachePath } from '../util/paths'
import { logger } from '../util/logger'

interface CachedRegistry {
  fetchedAt: number
  data: AcpRegistry
}

export class RegistryService {
  private cache: CachedRegistry | null = null

  /** Fetch the registry from CDN, with caching */
  async fetch(): Promise<AcpRegistry> {
    // Check in-memory cache first
    if (this.cache && Date.now() - this.cache.fetchedAt < REGISTRY_CACHE_TTL_MS) {
      logger.debug('Returning in-memory cached registry')
      return this.cache.data
    }

    // Check disk cache
    const diskCache = this.loadFromDisk()
    if (diskCache && Date.now() - diskCache.fetchedAt < REGISTRY_CACHE_TTL_MS) {
      logger.debug('Returning disk cached registry')
      this.cache = diskCache
      return diskCache.data
    }

    // Fetch fresh from CDN
    logger.info('Fetching ACP registry from CDN...')
    try {
      const response = await fetch(ACP_REGISTRY_URL)
      if (!response.ok) {
        throw new Error(`Registry fetch failed: ${response.status} ${response.statusText}`)
      }

      const data = (await response.json()) as AcpRegistry
      const cached: CachedRegistry = { fetchedAt: Date.now(), data }

      // Update caches
      this.cache = cached
      this.saveToDisk(cached)

      logger.info(`Registry loaded: ${data.agents.length} agents, version ${data.version}`)
      return data
    } catch (error) {
      logger.error('Failed to fetch registry:', error)

      // Fallback to stale cache if available
      if (diskCache) {
        logger.warn('Using stale disk cache as fallback')
        this.cache = diskCache
        return diskCache.data
      }
      if (this.cache) {
        logger.warn('Using stale memory cache as fallback')
        return this.cache.data
      }

      throw error
    }
  }

  /** Get cached registry without fetching */
  getCached(): AcpRegistry | null {
    if (this.cache) return this.cache.data
    const diskCache = this.loadFromDisk()
    if (diskCache) {
      this.cache = diskCache
      return diskCache.data
    }
    return null
  }

  /** Fetch a trusted ACP registry SVG icon. */
  async fetchRegistryIconSvg(agentId: string, icon?: string): Promise<string | null> {
    const iconUrl = getAgentIconUrl(agentId, icon)
    if (!iconUrl || !iconUrl.startsWith(ACP_CDN_URL)) {
      return null
    }

    const response = await fetch(iconUrl)
    if (!response.ok) {
      throw new Error(`Icon fetch failed: ${response.status} ${response.statusText}`)
    }

    const svg = await response.text()
    if (!svg.includes('<svg')) {
      return null
    }

    return svg
  }

  private loadFromDisk(): CachedRegistry | null {
    try {
      const cachePath = getRegistryCachePath()
      if (!fs.existsSync(cachePath)) return null
      const raw = fs.readFileSync(cachePath, 'utf-8')
      return JSON.parse(raw) as CachedRegistry
    } catch {
      return null
    }
  }

  private saveToDisk(cached: CachedRegistry): void {
    try {
      const cachePath = getRegistryCachePath()
      fs.writeFileSync(cachePath, JSON.stringify(cached, null, 2), 'utf-8')
    } catch (error) {
      logger.warn('Failed to write registry cache to disk:', error)
    }
  }
}

export const registryService = new RegistryService()
