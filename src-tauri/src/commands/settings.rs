use tauri::State;
use serde_json::Value as JsonValue;
use crate::state::AppState;
use crate::error::{AppError, Result};

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<JsonValue> {
    let settings = state.settings.lock().unwrap();
    let s = settings.get();
    serde_json::to_value(s).map_err(AppError::Json)
}

#[tauri::command]
pub async fn settings_set(
    state: State<'_, AppState>,
    payload: JsonValue,
) -> Result<()> {
    let settings = state.settings.lock().unwrap();
    settings.set(payload).map_err(|e| AppError::Other(e))
}

#[tauri::command]
pub async fn settings_set_agent(
    state: State<'_, AppState>,
    agent_id: String,
    settings_value: JsonValue,
) -> Result<()> {
    let settings = state.settings.lock().unwrap();
    settings.set_agent_settings(&agent_id, settings_value).map_err(|e| AppError::Other(e))
}
