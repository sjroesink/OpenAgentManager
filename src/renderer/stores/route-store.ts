import { create } from 'zustand'

export type Route = 'home' | 'settings' | 'agents' | 'diff'

export interface RouteParams {
  diffFile?: string
}

interface RouteEntry {
  route: Route
  params?: RouteParams
}

interface RouteState {
  current: RouteEntry
  backStack: RouteEntry[]
  forwardStack: RouteEntry[]
  canGoBack: boolean
  canGoForward: boolean

  navigate: (route: Route, params?: RouteParams) => void
  goBack: () => void
  goForward: () => void
}

const MAX_HISTORY = 50

export const useRouteStore = create<RouteState>((set, get) => ({
  current: { route: 'home' },
  backStack: [],
  forwardStack: [],
  canGoBack: false,
  canGoForward: false,

  navigate: (route, params) => {
    const state = get()
    if (state.current.route === route) return
    const newBackStack = [...state.backStack, state.current]
    if (newBackStack.length > MAX_HISTORY) newBackStack.shift()
    set({
      backStack: newBackStack,
      current: { route, params },
      forwardStack: [],
      canGoBack: true,
      canGoForward: false
    })
  },

  goBack: () => {
    const state = get()
    if (state.backStack.length === 0) return
    const prev = state.backStack[state.backStack.length - 1]
    set({
      forwardStack: [state.current, ...state.forwardStack],
      current: prev,
      backStack: state.backStack.slice(0, -1),
      canGoBack: state.backStack.length - 1 > 0,
      canGoForward: true
    })
  },

  goForward: () => {
    const state = get()
    if (state.forwardStack.length === 0) return
    const next = state.forwardStack[0]
    set({
      backStack: [...state.backStack, state.current],
      current: next,
      forwardStack: state.forwardStack.slice(1),
      canGoBack: true,
      canGoForward: state.forwardStack.length - 1 > 0
    })
  }
}))
