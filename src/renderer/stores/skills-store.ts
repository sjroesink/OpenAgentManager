import { create } from 'zustand'
import type { AgentSkill } from '@shared/types/settings'

interface SkillsState {
  skills: AgentSkill[]
  loading: boolean

  /** Load all skills from main process */
  loadSkills: () => Promise<void>

  /** Create a new skill */
  createSkill: (data: {
    name: string
    description: string
    prompt: string
    agentId?: string
  }) => Promise<AgentSkill>

  /** Update an existing skill */
  updateSkill: (
    id: string,
    updates: { name?: string; description?: string; prompt?: string; agentId?: string }
  ) => Promise<AgentSkill>

  /** Delete a skill by id */
  deleteSkill: (id: string) => Promise<void>

  /** Get skills filtered by agentId (includes global skills with no agentId) */
  getSkillsForAgent: (agentId: string | undefined) => AgentSkill[]
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  loading: false,

  loadSkills: async () => {
    set({ loading: true })
    try {
      const skills = await window.api.invoke('skills:list', undefined)
      set({ skills })
    } catch (error) {
      console.error('Failed to load skills:', error)
    } finally {
      set({ loading: false })
    }
  },

  createSkill: async (data) => {
    const skill = await window.api.invoke('skills:create', data)
    set((state) => ({ skills: [...state.skills, skill] }))
    return skill
  },

  updateSkill: async (id, updates) => {
    const skill = await window.api.invoke('skills:update', { id, ...updates })
    set((state) => ({
      skills: state.skills.map((s) => (s.id === id ? skill : s))
    }))
    return skill
  },

  deleteSkill: async (id) => {
    await window.api.invoke('skills:delete', { id })
    set((state) => ({ skills: state.skills.filter((s) => s.id !== id) }))
  },

  getSkillsForAgent: (agentId) => {
    const { skills } = get()
    if (!agentId) return skills
    return skills.filter((s) => !s.agentId || s.agentId === agentId)
  }
}))
