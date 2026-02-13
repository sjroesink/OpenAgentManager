import { create } from 'zustand'

type SidebarTab = 'threads' | 'files'
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
  sidebarTab: SidebarTab
  reviewTab: ReviewTab

  // Modals
  registryBrowserOpen: boolean
  settingsOpen: boolean

  // Selected file for diff viewer
  selectedDiffFile: string | null

  // Actions
  toggleSidebar: () => void
  toggleReviewPanel: () => void
  toggleTerminal: () => void
  setSidebarWidth: (width: number) => void
  setReviewPanelWidth: (width: number) => void
  setTerminalHeight: (height: number) => void
  setSidebarTab: (tab: SidebarTab) => void
  setReviewTab: (tab: ReviewTab) => void
  setRegistryBrowserOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setSelectedDiffFile: (path: string | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarVisible: true,
  reviewPanelVisible: false,
  terminalVisible: false,

  sidebarWidth: 280,
  reviewPanelWidth: 400,
  terminalHeight: 250,

  sidebarTab: 'threads',
  reviewTab: 'changes',

  registryBrowserOpen: false,
  settingsOpen: false,

  selectedDiffFile: null,

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleReviewPanel: () => set((s) => ({ reviewPanelVisible: !s.reviewPanelVisible })),
  toggleTerminal: () => set((s) => ({ terminalVisible: !s.terminalVisible })),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(200, Math.min(500, width)) }),
  setReviewPanelWidth: (width) => set({ reviewPanelWidth: Math.max(250, Math.min(700, width)) }),
  setTerminalHeight: (height) => set({ terminalHeight: Math.max(100, Math.min(600, height)) }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setReviewTab: (tab) => set({ reviewTab: tab }),
  setRegistryBrowserOpen: (open) => set({ registryBrowserOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSelectedDiffFile: (path) => set({ selectedDiffFile: path })
}))
