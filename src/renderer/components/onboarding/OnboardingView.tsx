import React, { useState, useEffect } from 'react'
import { useRouteStore } from '../../stores/route-store'
import { useAgentStore } from '../../stores/agent-store'
import { Button } from '../common/Button'
import { PrerequisitesStep } from './PrerequisitesStep'
import { AgentInstallStep } from './AgentInstallStep'
import { AgentAuthenticationStep } from './AgentAuthenticationStep'
import type { AppSettings } from '@shared/types/settings'

type WizardStep = 'prerequisites' | 'install-agents' | 'authenticate-agents'

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'prerequisites', label: 'Prerequisites' },
  { id: 'install-agents', label: 'Install Agents' },
  { id: 'authenticate-agents', label: 'Authenticate' }
]

export function OnboardingView() {
  const navigate = useRouteStore((s) => s.navigate)
  const { installed, fetchRegistry, loadInstalled } = useAgentStore()
  const [currentStep, setCurrentStep] = useState<WizardStep>('prerequisites')

  useEffect(() => {
    fetchRegistry()
    loadInstalled()
  }, [fetchRegistry, loadInstalled])

  const markOnboardingComplete = async () => {
    const current = await window.api.invoke('settings:get', undefined)
    await window.api.invoke('settings:set', {
      general: { ...current.general, completedOnboarding: true }
    } as Partial<AppSettings>)
    navigate('home')
  }

  const handleComplete = () => markOnboardingComplete()
  const handleSkip = () => markOnboardingComplete()

  const handleNext = () => {
    if (currentStep === 'prerequisites') {
      setCurrentStep('install-agents')
    } else if (currentStep === 'install-agents') {
      if (installed.length === 0) {
        handleComplete()
      } else {
        setCurrentStep('authenticate-agents')
      }
    } else {
      handleComplete()
    }
  }

  const handleBack = () => {
    if (currentStep === 'install-agents') {
      setCurrentStep('prerequisites')
    } else if (currentStep === 'authenticate-agents') {
      setCurrentStep('install-agents')
    }
  }

  const currentStepIndex = STEPS.findIndex((s) => s.id === currentStep)
  const isFirstStep = currentStep === 'prerequisites'
  const isLastStep =
    currentStep === 'authenticate-agents' ||
    (currentStep === 'install-agents' && installed.length === 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Welcome to OpenAgentManager</h1>
          <p className="text-sm text-text-secondary mt-1">
            Let&apos;s get you set up with AI coding agents
          </p>
        </div>
        <Button variant="ghost" onClick={handleSkip}>
          Skip Setup
        </Button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-8 py-4 px-8 border-b border-border bg-surface-1">
        {STEPS.map((step, index) => {
          const isActive = step.id === currentStep
          const isCompleted = index < currentStepIndex
          return (
            <React.Fragment key={step.id}>
              <div className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    isActive
                      ? 'bg-accent text-accent-text'
                      : isCompleted
                        ? 'bg-success/20 text-success'
                        : 'bg-surface-3 text-text-muted'
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                <span
                  className={`text-sm ${isActive ? 'text-text-primary font-medium' : 'text-text-muted'}`}
                >
                  {step.label}
                </span>
              </div>
              {index < STEPS.length - 1 && <div className="w-16 h-px bg-border" />}
            </React.Fragment>
          )
        })}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto">
        {currentStep === 'prerequisites' && <PrerequisitesStep />}
        {currentStep === 'install-agents' && <AgentInstallStep />}
        {currentStep === 'authenticate-agents' && <AgentAuthenticationStep />}
      </div>

      {/* Footer navigation */}
      <div className="flex items-center justify-between px-8 py-4 border-t border-border bg-surface-1">
        <div>
          {!isFirstStep && (
            <Button variant="secondary" onClick={handleBack}>
              Back
            </Button>
          )}
        </div>
        <Button variant="primary" onClick={handleNext}>
          {isLastStep ? 'Finish Setup' : 'Next'}
        </Button>
      </div>
    </div>
  )
}
