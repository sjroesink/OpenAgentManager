use std::collections::HashMap;
use tauri::{AppHandle, State};
use serde_json::Value as JsonValue;
use crate::state::AppState;
use crate::error::{AppError, Result};

#[tauri::command]
pub async fn agent_install(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<JsonValue> {
    let registry = {
        let r = state.registry.lock().unwrap();
        r.fetch().await.map_err(|e| AppError::Other(e))?
    };
    let download = state.download.lock().unwrap();
    let settings = state.settings.lock().unwrap();
    let mut agents = state.agents.lock().unwrap();

    // Build a temporary RegistryService ref by passing the already-fetched registry inline
    // We need to reconstruct slightly differently since we can't pass RegistryService across
    // Instead, use the registry value directly
    drop(registry); // We fetched it but need to re-fetch via the agent manager

    let registry_svc = state.registry.lock().unwrap();
    let result = agents.install(&agent_id, &*registry_svc, &*download, &*settings).await
        .map_err(|e| AppError::Other(e))?;

    serde_json::to_value(result).map_err(AppError::Json)
}

#[tauri::command]
pub async fn agent_uninstall(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<()> {
    let settings = state.settings.lock().unwrap();
    let mut agents = state.agents.lock().unwrap();
    agents.uninstall(&agent_id, &*settings);
    Ok(())
}

#[tauri::command]
pub async fn agent_list_installed(state: State<'_, AppState>) -> Result<JsonValue> {
    let agents = state.agents.lock().unwrap();
    let list = agents.list_installed();
    serde_json::to_value(list).map_err(AppError::Json)
}

#[tauri::command]
pub async fn agent_launch(
    app: AppHandle,
    state: State<'_, AppState>,
    agent_id: String,
    project_path: String,
    extra_env: Option<HashMap<String, String>>,
) -> Result<JsonValue> {
    let settings = state.settings.lock().unwrap();
    let registry = state.registry.lock().unwrap();
    let mut agents = state.agents.lock().unwrap();

    let connection = agents.launch(
        &agent_id,
        &project_path,
        extra_env,
        &*settings,
        &*registry,
        &app,
    ).await.map_err(|e| AppError::Other(e))?;

    serde_json::to_value(connection).map_err(AppError::Json)
}

#[tauri::command]
pub async fn agent_check_auth(
    app: AppHandle,
    state: State<'_, AppState>,
    agent_id: String,
    project_path: Option<String>,
) -> Result<JsonValue> {
    let path = project_path.unwrap_or_else(|| {
        dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    });

    let settings = state.settings.lock().unwrap();
    let registry = state.registry.lock().unwrap();
    let mut agents = state.agents.lock().unwrap();

    // Check if already connected
    let already_connected = agents.find_client_for_agent(&agent_id)
        .map(|c| c.connection_id.clone());

    let connection = if let Some(conn_id) = already_connected {
        let conn = agents.list_connections()
            .into_iter()
            .find(|c| c.connection_id == conn_id)
            .unwrap();
        conn
    } else {
        agents.launch(&agent_id, &path, None, &*settings, &*registry, &app).await
            .map_err(|e| AppError::Other(e))?
    };

    let auth_methods = agents.connections.get(&connection.connection_id)
        .map(|c| c.auth_methods.clone())
        .unwrap_or_default();

    let result = serde_json::json!({
        "agentId": agent_id,
        "checkedAt": chrono::Utc::now().to_rfc3339(),
        "projectPath": path,
        "isAuthenticated": true,
        "requiresAuthentication": false,
        "authMethods": auth_methods,
        "connection": serde_json::to_value(&connection).unwrap_or_default()
    });

    Ok(result)
}

#[tauri::command]
pub async fn agent_terminate(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<()> {
    let mut agents = state.agents.lock().unwrap();
    agents.terminate(&connection_id);
    Ok(())
}

#[tauri::command]
pub async fn agent_authenticate(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
    method: String,
    credentials: Option<HashMap<String, String>>,
) -> Result<()> {
    let mut agents = state.agents.lock().unwrap();
    agents.authenticate(&connection_id, &method, credentials, &app).await
        .map_err(|e| AppError::Other(e))
}

#[tauri::command]
pub async fn agent_logout(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<()> {
    let mut agents = state.agents.lock().unwrap();
    agents.logout(&connection_id).await
        .map_err(|e| AppError::Other(e))
}

#[tauri::command]
pub async fn agent_list_connections(state: State<'_, AppState>) -> Result<JsonValue> {
    let agents = state.agents.lock().unwrap();
    let connections = agents.list_connections();
    serde_json::to_value(connections).map_err(AppError::Json)
}

#[tauri::command]
pub async fn agent_get_models(
    app: AppHandle,
    state: State<'_, AppState>,
    agent_id: String,
    project_path: String,
) -> Result<JsonValue> {
    // Return empty catalog for now; model discovery happens during session/new
    Ok(serde_json::json!({ "availableModels": [] }))
}

#[tauri::command]
pub async fn agent_get_modes(
    app: AppHandle,
    state: State<'_, AppState>,
    agent_id: String,
    project_path: String,
) -> Result<JsonValue> {
    Ok(serde_json::json!({ "availableModes": [] }))
}

#[tauri::command]
pub async fn agent_detect_cli(
    state: State<'_, AppState>,
    commands: Vec<String>,
) -> Result<JsonValue> {
    let agents = state.agents.lock().unwrap();
    let results = agents.detect_cli_commands(&commands);
    serde_json::to_value(results).map_err(AppError::Json)
}
