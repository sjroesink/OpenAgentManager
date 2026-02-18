use tauri::{AppHandle, State};
use serde_json::Value as JsonValue;
use crate::state::AppState;
use crate::error::{AppError, Result};

#[tauri::command]
pub async fn terminal_create(
    app: AppHandle,
    state: State<'_, AppState>,
    cwd: String,
    session_id: String,
) -> Result<String> {
    let settings = state.settings.lock().unwrap();
    let shell = settings.get().general.terminal_shell.clone();
    let mut terminals = state.terminals.lock().unwrap();

    terminals.create(&cwd, &session_id, shell.as_deref(), &app)
        .map_err(|e| AppError::Other(e))
}

#[tauri::command]
pub async fn terminal_write(
    state: State<'_, AppState>,
    terminal_id: String,
    data: String,
) -> Result<()> {
    let mut terminals = state.terminals.lock().unwrap();
    terminals.write(&terminal_id, &data).map_err(|e| AppError::Other(e))
}

#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, AppState>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<()> {
    let mut terminals = state.terminals.lock().unwrap();
    terminals.resize(&terminal_id, cols, rows).map_err(|e| AppError::Other(e))
}

#[tauri::command]
pub async fn terminal_kill(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<()> {
    let mut terminals = state.terminals.lock().unwrap();
    terminals.kill(&terminal_id);
    Ok(())
}
