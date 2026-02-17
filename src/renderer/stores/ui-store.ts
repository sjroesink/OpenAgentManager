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
  registryBrowserOpen: boolean
  settingsOpen: boolean
  newThreadDialogOpen: boolean

  // Selected file for diff viewer
  selectedDiffFile: string | null

  // Full-page diff view
  diffViewOpen: boolean
  diffViewSelectedFile: string | null

  // Threads overview
  threadsOverviewOpen: boolean
  threadsOverviewSearchQuery: string

  // Actions
  toggleSidebar: () => void
  toggleReviewPanel: () => void
  toggleTerminal: () => void
  setSidebarWidth: (width: number) => void
  setReviewPanelWidth: (width: number) => void
  setTerminalHeight: (height: number) => void
  setReviewTab: (tab: ReviewTab) => void
  setRegistryBrowserOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setNewThreadDialogOpen: (open: boolean) => void
  setSelectedDiffFile: (path: string | null) => void
  openDiffView: (filePath?: string) => void
  closeDiffView: () => void
  setDiffViewSelectedFile: (path: string | null) => void
  openThreadsOverview: (searchQuery?: string) => void
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

  registryBrowserOpen: false,
  settingsOpen: false,
  newThreadDialogOpen: false,

  selectedDiffFile: null,

  diffViewOpen: false,
  diffViewSelectedFile: null,

  threadsOverviewOpen: false,
  threadsOverviewSearchQuery: '',

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleReviewPanel: () => set((s) => ({ reviewPanelVisible: !s.reviewPanelVisible })),
  toggleTerminal: () => set((s) => ({ terminalVisible: !s.terminalVisible })),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(200, Math.min(500, width)) }),
  setReviewPanelWidth: (width) => set({ reviewPanelWidth: Math.max(250, Math.min(700, width)) }),
  setTerminalHeight: (height) => set({ terminalHeight: Math.max(100, Math.min(600, height)) }),
  setReviewTab: (tab) => set({ reviewTab: tab }),
  setRegistryBrowserOpen: (open) => set({ registryBrowserOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setNewThreadDialogOpen: (open) => set({ newThreadDialogOpen: open }),
  setSelectedDiffFile: (path) => set({ selectedDiffFile: path }),
  openDiffView: (filePath) => set({ diffViewOpen: true, diffViewSelectedFile: filePath ?? null }),
  closeDiffView: () => set({ diffViewOpen: false, diffViewSelectedFile: null }),
  setDiffViewSelectedFile: (path) => set({ diffViewSelectedFile: path }),
  openThreadsOverview: (searchQuery) => set({ threadsOverviewOpen: true, threadsOverviewSearchQuery: searchQuery ?? '' }),
  closeThreadsOverview: () => set({ threadsOverviewOpen: false, threadsOverviewSearchQuery: '' }),
  setThreadsOverviewSearchQuery: (query) => set({ threadsOverviewSearchQuery: query })
}))
