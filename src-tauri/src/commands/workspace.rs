use tauri::{AppHandle, State};
use serde_json::Value as JsonValue;
use crate::state::AppState;
use crate::error::{AppError, Result};

#[tauri::command]
pub async fn workspace_list(state: State<'_, AppState>) -> Result<JsonValue> {
    let workspaces = state.workspaces.lock().unwrap();
    let list = workspaces.list();
    serde_json::to_value(list).map_err(AppError::Json)
}

#[tauri::command]
pub async fn workspace_create(
    state: State<'_, AppState>,
    path: String,
    name: Option<String>,
) -> Result<JsonValue> {
    let workspaces = state.workspaces.lock().unwrap();
    let ws = workspaces.create(&path, name.as_deref()).map_err(|e| AppError::Other(e))?;
    serde_json::to_value(ws).map_err(AppError::Json)
}

#[tauri::command]
pub async fn workspace_remove(
    state: State<'_, AppState>,
    id: String,
    cleanup_worktrees: Option<bool>,
) -> Result<()> {
    let workspaces = state.workspaces.lock().unwrap();
    workspaces.remove(&id).map_err(|e| AppError::Other(e))
}

#[tauri::command]
pub async fn workspace_update(
    state: State<'_, AppState>,
    id: String,
    updates: JsonValue,
) -> Result<JsonValue> {
    let workspaces = state.workspaces.lock().unwrap();
    let ws = workspaces.update(&id, updates).map_err(|e| AppError::Other(e))?;
    serde_json::to_value(ws).map_err(AppError::Json)
}

#[tauri::command]
pub async fn workspace_select_directory(app: AppHandle) -> Result<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let dir = app.dialog()
        .file()
        .pick_folder()
        .await;

    Ok(dir.and_then(|p| p.to_str().map(|s| s.to_string())))
}

#[tauri::command]
pub async fn workspace_open_in_vscode(path: String) -> Result<()> {
    std::process::Command::new("code")
        .arg(&path)
        .spawn()
        .map_err(|e| AppError::Other(format!("Failed to open VS Code: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub async fn workspace_open_directory(app: AppHandle, path: String) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn workspace_get_config(workspace_path: String) -> Result<Option<JsonValue>> {
    let config_path = std::path::Path::new(&workspace_path)
        .join(".agent")
        .join("config.json");

    if !config_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(AppError::Io)?;
    let config: JsonValue = serde_json::from_str(&content).map_err(AppError::Json)?;
    Ok(Some(config))
}

#[tauri::command]
pub async fn workspace_set_config(
    workspace_path: String,
    config: JsonValue,
) -> Result<()> {
    let agent_dir = std::path::Path::new(&workspace_path).join(".agent");
    std::fs::create_dir_all(&agent_dir).map_err(AppError::Io)?;

    let config_path = agent_dir.join("config.json");
    let json = serde_json::to_string_pretty(&config).map_err(AppError::Json)?;
    std::fs::write(&config_path, json).map_err(AppError::Io)?;
    Ok(())
}
