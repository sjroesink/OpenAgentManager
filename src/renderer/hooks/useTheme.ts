import { useEffect, useCallback } from 'react'

type Theme = 'light' | 'dark' | 'system'

function applyTheme(theme: Theme): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark)

  document.documentElement.classList.toggle('dark', isDark)
}

/**
 * Loads the theme setting from settings and applies it.
 * Listens for OS preference changes when theme is 'system'.
 */
export function useTheme(): void {
  const loadAndApply = useCallback(async () => {
    const settings = await window.api.invoke('settings:get', undefined)
    applyTheme(settings.general.theme)
  }, [])

  // Load theme on mount
  useEffect(() => {
    loadAndApply()
  }, [loadAndApply])

  // Listen for OS preference changes (relevant when theme is 'system')
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handler = async (): Promise<void> => {
      const settings = await window.api.invoke('settings:get', undefined)
      if (settings.general.theme === 'system') {
        applyTheme('system')
      }
    }

    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  // Re-apply theme whenever settings are saved
  // Listen to the custom event dispatched after settings:set
  useEffect(() => {
    const handler = (): void => {
      loadAndApply()
    }
    window.addEventListener('theme-changed', handler)
    return () => window.removeEventListener('theme-changed', handler)
  }, [loadAndApply])
}
