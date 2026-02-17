import { create } from 'zustand'

type ReviewTab = 'changes' | 'diff'

interface UiState {
  // Panel visibility
  sidebarVisible: boolean
  reviewPanelVisible: boolean
  terminalVisible: boolean

  // Panel sizes
  sidebarWidth: number
  reviewPanelWidth: number
  terminalHeight: number

  // Active tabs
  reviewTab: ReviewTab

  // Modals
  newThreadDialogOpen: boolean

  // Selected file for diff viewer (review panel inline diff)
  selectedDiffFile: string | null

  // Selected file in full-page diff view
  diffViewSelectedFile: string | null

  // Threads overview
  threadsOverviewOpen: boolean
  threadsOverviewSearchQuery: string
  threadsOverviewFocusSearch: boolean

  // Actions
  toggleSidebar: () => void
  toggleReviewPanel: () => void
  toggleTerminal: () => void
  setSidebarWidth: (width: number) => void
  setReviewPanelWidth: (width: number) => void
  setTerminalHeight: (height: number) => void
  setReviewTab: (tab: ReviewTab) => void
  setNewThreadDialogOpen: (open: boolean) => void
  setSelectedDiffFile: (path: string | null) => void
  setDiffViewSelectedFile: (path: string | null) => void
  openThreadsOverview: (searchQuery?: string, focusSearch?: boolean) => void
  closeThreadsOverview: () => void
  setThreadsOverviewSearchQuery: (query: string) => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarVisible: true,
  reviewPanelVisible: false,
  terminalVisible: false,

  sidebarWidth: 280,
  reviewPanelWidth: 400,
  terminalHeight: 250,

  reviewTab: 'changes',

  newThreadDialogOpen: false,

  selectedDiffFile: null,

  diffViewSelectedFile: null,

  threadsOverviewOpen: false,
  threadsOverviewSearchQuery: '',
  threadsOverviewFocusSearch: false,

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleReviewPanel: () => set((s) => ({ reviewPanelVisible: !s.reviewPanelVisible })),
  toggleTerminal: () => set((s) => ({ terminalVisible: !s.terminalVisible })),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(200, Math.min(500, width)) }),
  setReviewPanelWidth: (width) => set({ reviewPanelWidth: Math.max(250, Math.min(700, width)) }),
  setTerminalHeight: (height) => set({ terminalHeight: Math.max(100, Math.min(600, height)) }),
  setReviewTab: (tab) => set({ reviewTab: tab }),
  setNewThreadDialogOpen: (open) => set({ newThreadDialogOpen: open }),
  setSelectedDiffFile: (path) => set({ selectedDiffFile: path }),
  setDiffViewSelectedFile: (path) => set({ diffViewSelectedFile: path }),
  openThreadsOverview: (searchQuery, focusSearch = false) =>
    set({
      threadsOverviewOpen: true,
      threadsOverviewSearchQuery: searchQuery ?? '',
      threadsOverviewFocusSearch: focusSearch
    }),
  closeThreadsOverview: () =>
    set({
      threadsOverviewOpen: false,
      threadsOverviewSearchQuery: '',
      threadsOverviewFocusSearch: false
    }),
  setThreadsOverviewSearchQuery: (query) => set({ threadsOverviewSearchQuery: query })
}))
