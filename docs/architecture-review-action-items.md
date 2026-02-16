# Architecture Review - Actionable Improvement Backlog

Date: 2026-02-16  
Reviewer role: Software Architect (deep-dive review)

This document lists independent work items that can be picked up separately.

## 1. Restore Workspace Type/Store Contract Consistency (Build-Breaking)
- Priority: Critical
- Problem: Renderer code depends on `WorkspaceInfo.defaultAgentId`, `WorkspaceInfo.defaultUseWorktree`, and a store action `updateWorkspace`, but these are missing from shared/store contracts.
- Impact: `npm run typecheck` currently fails, blocking CI-quality checks and making feature work risky.
- Evidence:
  - `src/shared/types/workspace.ts:5`
  - `src/renderer/stores/workspace-store.ts:4`
  - `src/renderer/components/sidebar/WorkspaceSettingsDialog.tsx:36`
  - `src/renderer/components/sidebar/NewThreadDialog.tsx:29`
  - `src/renderer/components/sidebar/WorkspaceSection.tsx:371`
  - `src/renderer/components/thread/DraftThreadView.tsx:34`
- Action:
  - Add missing optional fields to `WorkspaceInfo`.
  - Add `updateWorkspace` action in `workspace-store` and wire to `'workspace:update'`.
  - Align main-process `workspace:update` typing to include the fields that UI edits.
- Acceptance criteria:
  - `npm run typecheck` completes without errors.
  - Workspace defaults can be saved and reloaded end-to-end.

## 2. Fix Linting Pipeline (Currently Non-Functional)
- Priority: High
- Problem: `npm run lint` fails because `eslint` is not installed/configured in this repo.
- Impact: No enforced static quality gate; style and defect patterns drift over time.
- Evidence:
  - `package.json:14`
  - No ESLint config file present (`.eslintrc*` / `eslint.config.*` not found).
- Action:
  - Add ESLint as a dev dependency.
  - Add a modern config (`eslint.config.js` or equivalent) for TS + React.
  - Keep lint command in CI/pre-commit path.
- Acceptance criteria:
  - `npm run lint` runs successfully and reports actionable lint issues.

## 3. Remove Remote SVG Injection Risk in Renderer
- Priority: High
- Problem: Remote SVG is fetched from CDN and injected with `dangerouslySetInnerHTML`.
- Impact: Increases XSS risk surface (especially if upstream source is compromised or unexpectedly returns active content).
- Evidence:
  - `src/renderer/components/sidebar/WorkspaceSection.tsx:37`
  - `src/renderer/components/sidebar/AgentSelector.tsx:22`
  - `src/renderer/components/sidebar/ThreadList.tsx:38`
  - `src/renderer/components/registry/AgentCard.tsx:26`
  - `src/renderer/components/layout/MainPanel.tsx:26`
- Action:
  - Replace raw HTML injection with a safer icon strategy:
    - Local vetted icon bundle, or
    - Sanitization pipeline before rendering, or
    - Render as `<img src>` without inline execution context.
- Acceptance criteria:
  - No `dangerouslySetInnerHTML` for remote SVG payloads.
  - Icon rendering continues to work in sidebar/registry/thread views.

## 4. Harden Electron Security Baseline
- Priority: High
- Problem: BrowserWindow currently runs with `sandbox: false`.
- Impact: Lower renderer containment if compromised; increases blast radius of a renderer bug/XSS.
- Evidence:
  - `src/main/window.ts:22`
- Action:
  - Evaluate enabling `sandbox: true` and resolve preload/API compatibility issues.
  - Review `contextIsolation`, permissions, and IPC exposure together as a hardening package.
- Acceptance criteria:
  - App works with sandbox enabled (or documented rationale + compensating controls if not possible).

## 5. Prevent Command Injection in `workspace:open-in-vscode`
- Priority: High
- Problem: VS Code launch uses shell interpolation with `exec(\`code "${path}"\`)`.
- Impact: Path values containing shell metacharacters/quotes can result in command injection.
- Evidence:
  - `src/main/ipc/workspace-handlers.ts:48`
- Action:
  - Replace `exec` with `spawn`/`execFile` and argument array (`code`, `[path]`), no shell interpolation.
- Acceptance criteria:
  - Opening workspace in VS Code works for paths with spaces/special chars.
  - No shell string concatenation for this action.

## 6. Add IPC Input Validation and Path Guardrails
- Priority: High
- Problem: IPC handlers accept raw user-provided paths and payloads without schema validation and allow unrestricted file reads.
- Impact: If renderer is compromised, privileged main-process operations can be abused (path traversal / arbitrary local file access).
- Evidence:
  - `src/main/ipc/file-handlers.ts:13`
  - `src/main/services/file-service.ts:39`
  - `src/main/ipc/workspace-handlers.ts:47`
- Action:
  - Introduce runtime schema validation (e.g., zod) for IPC request payloads.
  - Restrict file operations to configured workspace roots where applicable.
  - Add explicit allowlist/denylist checks for sensitive path patterns.
- Acceptance criteria:
  - Invalid IPC payloads are rejected consistently.
  - File read/list actions are constrained to expected boundaries.

## 7. Fix Preload Event Unsubscribe Contract
- Priority: Medium
- Problem: `off()` removes the raw callback, but `on()` registers a wrapper handler; the callback cannot actually be removed by `off()`.
- Impact: Potential event listener leaks and duplicate updates across mounts/unmounts.
- Evidence:
  - `src/preload/index.ts:16`
  - `src/preload/index.ts:27`
- Action:
  - Store callback-to-handler mappings or remove `off()` API and standardize on disposer function returned by `on()`.
- Acceptance criteria:
  - Event listeners are reliably detached in all UI lifecycles.

## 8. Remove Production Debug Logging and Standardize Logger Usage
- Priority: Medium
- Problem: Multiple `console.log` statements remain in IPC/store/UI paths, mixed with structured logger usage.
- Impact: Noisy logs, inconsistent observability, and possible data leakage in production logs.
- Evidence:
  - `src/main/ipc/session-handlers.ts:79`
  - `src/main/ipc/session-handlers.ts:90`
  - `src/renderer/stores/session-store.ts:187`
  - `src/renderer/components/sidebar/WorkspaceSection.tsx:408`
- Action:
  - Replace debug `console.*` with environment-gated structured logging.
  - Define log policy for sensitive fields and verbosity levels.
- Acceptance criteria:
  - No ad hoc debug logs in production paths.
  - Log output remains useful for diagnostics.

## 9. Redact Sensitive ACP Traffic from Logs
- Priority: Medium
- Problem: Full ACP JSON-RPC payloads are logged for send/receive paths; these can include prompts, tokens, credentials, and tool IO.
- Impact: Sensitive data can end up in local log files/diagnostics.
- Evidence:
  - `src/main/services/acp-client.ts:486`
  - `src/main/services/acp-client.ts:581`
  - `src/main/services/agent-manager.ts:181`
  - `src/main/services/agent-manager.ts:326`
- Action:
  - Redact sensitive fields (`apiKey`, auth credentials, prompt content where needed).
  - Keep high-level metadata logs (method names, timing, status codes) by default.
- Acceptance criteria:
  - No raw secrets/user prompt bodies in standard logs.

## 10. Resolve Hardcoded Git Base Branch in Diff View
- Priority: Medium
- Problem: Diff UI hardcodes base branch to `main`.
- Impact: Wrong branch context in repos using `master`, trunk strategies, or nonstandard defaults.
- Evidence:
  - `src/renderer/components/diff/DiffView.tsx:66`
- Action:
  - Detect base branch from repository metadata/settings and surface actual branch relation in UI.
- Acceptance criteria:
  - Branch label reflects real repo default/upstream configuration.

## 11. Clarify Settings That Are Exposed but Not Operationalized
- Priority: Medium
- Problem: Some settings are presented in types/UI but appear unused or only partially wired in runtime behavior.
- Impact: User confusion and configuration drift (settings seem available but have no effect).
- Evidence:
  - `src/shared/types/settings.ts:14`
  - `src/shared/types/settings.ts:20`
  - `src/shared/types/settings.ts:30`
- Action:
  - Audit each setting for runtime usage.
  - Either implement behavior fully or hide/remove unsupported options.
  - Add unit-level coverage for settings application.
- Acceptance criteria:
  - Every exposed setting has clear runtime effect or is removed/documented as future work.

## 12. Add Basic Automated Test Coverage for Core Services
- Priority: Medium
- Problem: No test framework is configured for a stateful, process-heavy app.
- Impact: High regression risk in session lifecycle, IPC contracts, and persistence migration paths.
- Evidence:
  - `AGENTS.md` states no configured test framework.
- Action:
  - Introduce a minimal test stack for main-process service logic (session manager, workspace service, thread store, IPC validation).
  - Start with smoke tests for create/prompt/remove and workspace lifecycle.
- Acceptance criteria:
  - CI runs at least a baseline service test suite.
  - Critical workflows covered by regression tests.

