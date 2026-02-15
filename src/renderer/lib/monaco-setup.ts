import * as monaco from 'monaco-editor'

// Import editor worker for Vite bundling
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

// Configure Monaco environment for worker loading
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  }
}

// Custom dark theme matching the app's CSS variables
monaco.editor.defineTheme('agent-manager-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1a1a1a',
    'editor.foreground': '#e5e5e5',
    'editorLineNumber.foreground': '#666666',
    'editorLineNumber.activeForeground': '#a0a0a0',
    'editor.lineHighlightBackground': '#24242400',
    'editorWidget.background': '#1a1a1a',
    'editorWidget.border': '#333333',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#33333380',
    'scrollbarSlider.hoverBackground': '#66666680',
    'scrollbarSlider.activeBackground': '#66666680',
    // Diff colors
    'diffEditor.insertedTextBackground': '#22c55e18',
    'diffEditor.removedTextBackground': '#ef444418',
    'diffEditor.insertedLineBackground': '#22c55e10',
    'diffEditor.removedLineBackground': '#ef444410',
    'diffEditorGutter.insertedLineBackground': '#22c55e30',
    'diffEditorGutter.removedLineBackground': '#ef444430',
    'diffEditor.diagonalFill': '#33333340'
  }
})

export { monaco }
