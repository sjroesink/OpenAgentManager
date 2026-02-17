import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'test'
    }
  })

  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app.close()
})

// Helper: ensure no dialog is open before a test
async function closeAnyDialog() {
  // Press Escape a couple of times to close any open dialog/menu
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
}

// ---------------------------------------------------------------------------
// Window basics
// ---------------------------------------------------------------------------

test.describe('Window', () => {
  test('has the correct title', async () => {
    const title = await page.title()
    expect(title).toBe('AgentManager')
  })

  test('window has reasonable dimensions', async () => {
    const size = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const [width, height] = win?.getSize() ?? [0, 0]
      return { width, height }
    })
    expect(size.width).toBeGreaterThanOrEqual(800)
    expect(size.height).toBeGreaterThanOrEqual(600)
  })

  test('window is not minimized', async () => {
    const isMinimized = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win?.isMinimized() ?? true
    })
    expect(isMinimized).toBe(false)
  })

  test('window is visible', async () => {
    const isVisible = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win?.isVisible() ?? false
    })
    expect(isVisible).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// App layout
// ---------------------------------------------------------------------------

test.describe('App Layout', () => {
  test('renders the root element', async () => {
    const root = page.locator('#root')
    await expect(root).toBeAttached()
  })

  test('renders the toolbar', async () => {
    const toolbar = page.locator('.titlebar-drag').first()
    await expect(toolbar).toBeVisible()
  })

  test('renders the sidebar with New Thread button', async () => {
    // Two New Thread buttons exist (sidebar + main panel empty state); check the first (sidebar)
    const newThreadButton = page.getByRole('button', { name: /New Thread/i }).first()
    await expect(newThreadButton).toBeVisible()
  })

  test('renders the status bar at the bottom', async () => {
    const statusBar = page.locator('.h-6.border-t').first()
    await expect(statusBar).toBeVisible()
  })

  test('shows empty state message when no sessions', async () => {
    const emptyMessage = page.getByText("Let's build")
    await expect(emptyMessage).toBeVisible()
  })

  test('shows "Create a new thread" instruction', async () => {
    const instruction = page.getByText('Create a new thread to start working with an agent')
    await expect(instruction).toBeVisible()
  })

  test('has a New Thread button in the main panel empty state', async () => {
    // Two "New Thread" buttons: one in sidebar, one in main panel empty state
    const buttons = page.getByRole('button', { name: /New Thread/i })
    await expect(buttons).toHaveCount(2)
  })
})

// ---------------------------------------------------------------------------
// Toolbar interactions
// ---------------------------------------------------------------------------

test.describe('Toolbar', () => {
  test('has hamburger menu button', async () => {
    const menuButton = page.locator('button[title="Menu"]')
    await expect(menuButton).toBeVisible()
  })

  test('has sidebar toggle button', async () => {
    const sidebarToggle = page.locator('button[title*="Toggle sidebar"]')
    await expect(sidebarToggle).toBeVisible()
  })

  test('has Agents button', async () => {
    const agentsButton = page.getByRole('button', { name: /Agents/i })
    await expect(agentsButton).toBeVisible()
  })

  test('has diff view toggle', async () => {
    const diffToggle = page.locator('button[title*="Diff view"]')
    await expect(diffToggle).toBeVisible()
  })

  test('has review panel toggle', async () => {
    const reviewToggle = page.locator('button[title="Toggle review panel"]')
    await expect(reviewToggle).toBeVisible()
  })

  test('has terminal toggle', async () => {
    const terminalToggle = page.locator('button[title="Toggle terminal"]')
    await expect(terminalToggle).toBeVisible()
  })

  test('has settings button', async () => {
    const settingsButton = page.locator('button[title="Settings"]')
    await expect(settingsButton).toBeVisible()
  })

  test('opens and closes hamburger menu', async () => {
    const menuButton = page.locator('button[title="Menu"]')

    // Open menu
    await menuButton.click()

    // Menu should show File, Edit, View, Window, Help groups
    await expect(page.getByText('File', { exact: true })).toBeVisible()
    await expect(page.getByText('Edit', { exact: true })).toBeVisible()
    await expect(page.getByText('View', { exact: true })).toBeVisible()
    await expect(page.getByText('Window', { exact: true })).toBeVisible()
    await expect(page.getByText('Help', { exact: true })).toBeVisible()

    // Close by pressing Escape
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    await expect(page.locator('.absolute.top-10.left-0.z-50')).toBeHidden()
  })

  test('hamburger menu shows File section items by default', async () => {
    const menuButton = page.locator('button[title="Menu"]')
    await menuButton.click()

    // File section should show Settings, Close Window, Quit
    await expect(page.getByText('Settings', { exact: true })).toBeVisible()
    await expect(page.getByText('Close Window')).toBeVisible()
    await expect(page.getByText('Quit')).toBeVisible()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  })

  test('hamburger menu View section shows panel toggles', async () => {
    const menuButton = page.locator('button[title="Menu"]')
    await menuButton.click()

    // Hover over View to switch section
    await page.getByText('View', { exact: true }).hover()

    await expect(page.getByText('Toggle Sidebar')).toBeVisible()
    await expect(page.getByText('Toggle Review Panel')).toBeVisible()
    await expect(page.getByText('Toggle Terminal')).toBeVisible()
    await expect(page.getByText('Agent Registry')).toBeVisible()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  })
})

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

test.describe('Sidebar', () => {
  test('can toggle sidebar visibility', async () => {
    const sidebarToggle = page.locator('button[title*="Toggle sidebar"]')
    // Use the sidebar container (has the resize separator) rather than a button
    // that also exists in the main panel
    const sidebar = page.locator('div[role="separator"][aria-label="Resize sidebar"]')

    // Initially visible
    await expect(sidebar).toBeVisible()

    // Toggle off
    await sidebarToggle.click()
    await expect(sidebar).toBeHidden()

    // Toggle back on
    await sidebarToggle.click()
    await expect(sidebar).toBeVisible()
  })

  test('shows empty workspace message when no workspaces', async () => {
    const emptyMessage = page.getByText('No workspaces yet')
    await expect(emptyMessage).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Settings dialog
// ---------------------------------------------------------------------------

test.describe('Settings Dialog', () => {
  test('opens settings via toolbar button and shows General section', async () => {
    await closeAnyDialog()

    const settingsButton = page.locator('button[title="Settings"]')
    await settingsButton.click()

    // Dialog should appear with title "Settings"
    const dialogTitle = page.getByRole('heading', { name: 'Settings' })
    await expect(dialogTitle).toBeVisible()

    // General section elements visible by default
    await expect(page.getByText('Theme')).toBeVisible()
    await expect(page.getByText('Font Size')).toBeVisible()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  })

  test('has section navigation: General, Git & Worktrees, Agents, MCP Servers', async () => {
    await closeAnyDialog()

    await page.locator('button[title="Settings"]').click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    // The settings dialog has a sidebar with section buttons
    const settingsPanel = page.locator('.fixed.inset-0.z-50')
    await expect(settingsPanel.getByText('General', { exact: true })).toBeVisible()
    await expect(settingsPanel.getByText('Git & Worktrees')).toBeVisible()
    await expect(settingsPanel.getByText('Agents', { exact: true })).toBeVisible()
    await expect(settingsPanel.getByText('MCP Servers')).toBeVisible()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  })

  test('can navigate to Git & Worktrees section', async () => {
    await closeAnyDialog()

    await page.locator('button[title="Settings"]').click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    const settingsPanel = page.locator('.fixed.inset-0.z-50')
    await settingsPanel.getByText('Git & Worktrees').click()

    await expect(page.getByText('Enable Worktrees')).toBeVisible()
    await expect(page.getByText('Commit Prefix')).toBeVisible()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  })

  test('can navigate to Agents section', async () => {
    await closeAnyDialog()

    await page.locator('button[title="Settings"]').click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    const settingsPanel = page.locator('.fixed.inset-0.z-50')
    await settingsPanel.getByText('Agents', { exact: true }).click()

    await expect(page.getByText('Agent-specific settings')).toBeVisible()
    await expect(page.getByText('No agents installed yet')).toBeVisible()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  })

  test('can navigate to MCP Servers section', async () => {
    await closeAnyDialog()

    await page.locator('button[title="Settings"]').click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    const settingsPanel = page.locator('.fixed.inset-0.z-50')
    await settingsPanel.getByText('MCP Servers').click()

    await expect(page.getByText('Configure external MCP servers')).toBeVisible()
    await expect(page.getByText('No MCP servers configured yet')).toBeVisible()
    await expect(page.getByRole('button', { name: /Add Server/i })).toBeVisible()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  })

  test('can add an MCP server entry', async () => {
    await closeAnyDialog()

    await page.locator('button[title="Settings"]').click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    const settingsPanel = page.locator('.fixed.inset-0.z-50')
    await settingsPanel.getByRole('button', { name: 'MCP Servers' }).click()

    const addButton = page.getByRole('button', { name: /Add Server/i })
    await addButton.click()

    await expect(page.getByPlaceholder('Server name')).toBeVisible()
    await expect(page.getByText('Transport')).toBeVisible()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  })

  test('has Save Settings button', async () => {
    await closeAnyDialog()

    await page.locator('button[title="Settings"]').click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    const saveButton = page.getByRole('button', { name: /Save Settings/i })
    await expect(saveButton).toBeVisible()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  })

  test('closes settings dialog with Escape', async () => {
    await closeAnyDialog()

    await page.locator('button[title="Settings"]').click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeHidden()
  })

  test('opens and closes settings via hamburger menu', async () => {
    await closeAnyDialog()

    // Open menu
    await page.locator('button[title="Menu"]').click()

    // Click Settings from File menu
    const settingsMenuItem = page.locator('.absolute.top-10 button').filter({ hasText: 'Settings' })
    await settingsMenuItem.click()

    // Dialog should open
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    // Close
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeHidden()
  })
})

// ---------------------------------------------------------------------------
// Agent Registry dialog
// ---------------------------------------------------------------------------

test.describe('Agent Registry', () => {
  test('opens agent registry via toolbar Agents button', async () => {
    await closeAnyDialog()

    const agentsButton = page.getByRole('button', { name: /Agents/i })
    await agentsButton.click()

    const dialogTitle = page.getByRole('heading', { name: 'ACP Agent Registry' })
    await expect(dialogTitle).toBeVisible()
  })

  test('has a search input', async () => {
    const searchInput = page.getByPlaceholder('Search agents...')
    await expect(searchInput).toBeVisible()
  })

  test('closes agent registry with Escape', async () => {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    const dialogTitle = page.getByRole('heading', { name: 'ACP Agent Registry' })
    await expect(dialogTitle).toBeHidden()
  })
})

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

test.describe('Keyboard Shortcuts', () => {
  test('Ctrl+Shift+D toggles diff view', async () => {
    await closeAnyDialog()

    // Initially main panel should show empty state
    await expect(page.getByText("Let's build")).toBeVisible()

    // Toggle diff view on
    await page.keyboard.press('Control+Shift+D')
    await page.waitForTimeout(300)

    // The diff toggle button in toolbar should have active style
    const diffToggle = page.locator('button[title*="Diff view"]')
    await expect(diffToggle).toHaveClass(/bg-accent/)

    // Toggle diff view off
    await page.keyboard.press('Control+Shift+D')
    await page.waitForTimeout(300)

    await expect(page.getByText("Let's build")).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Theme and styling
// ---------------------------------------------------------------------------

test.describe('Theme', () => {
  test('app uses dark theme by default', async () => {
    const html = page.locator('html')
    await expect(html).toHaveClass(/dark/)
  })

  test('body has dark background', async () => {
    const bgColor = await page.locator('body').evaluate((el) =>
      getComputedStyle(el).backgroundColor
    )
    // bg-surface-0 is #0f0f0f -> rgb(15, 15, 15)
    expect(bgColor).toBe('rgb(15, 15, 15)')
  })
})

// ---------------------------------------------------------------------------
// Electron APIs
// ---------------------------------------------------------------------------

test.describe('Electron Integration', () => {
  test('preload exposes window.api', async () => {
    const hasApi = await page.evaluate(() => typeof (window as any).api !== 'undefined')
    expect(hasApi).toBe(true)
  })

  test('window.api has invoke method', async () => {
    const hasInvoke = await page.evaluate(
      () => typeof (window as any).api?.invoke === 'function'
    )
    expect(hasInvoke).toBe(true)
  })

  test('window.api has on method', async () => {
    const hasOn = await page.evaluate(
      () => typeof (window as any).api?.on === 'function'
    )
    expect(hasOn).toBe(true)
  })
})
