use tauri::State;
use serde_json::Value as JsonValue;
use crate::state::AppState;
use crate::error::Result;

#[tauri::command]
pub async fn registry_fetch(state: State<'_, AppState>) -> Result<JsonValue> {
    let registry = state.registry.lock().unwrap();
    let result = registry.fetch().await
        .map_err(|e| crate::error::AppError::Other(e))?;
    serde_json::to_value(result).map_err(|e| crate::error::AppError::Json(e))
}

#[tauri::command]
pub async fn registry_get_cached(state: State<'_, AppState>) -> Result<Option<JsonValue>> {
    let registry = state.registry.lock().unwrap();
    match registry.get_cached() {
        Some(r) => Ok(Some(serde_json::to_value(r).map_err(|e| crate::error::AppError::Json(e))?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn registry_get_icon_svg(
    state: State<'_, AppState>,
    agent_id: String,
    icon: Option<String>,
) -> Result<Option<String>> {
    let registry = state.registry.lock().unwrap();
    registry.get_icon_svg(&agent_id, icon.as_deref()).await
        .map_err(|e| crate::error::AppError::Other(e))
}
