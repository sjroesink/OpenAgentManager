use tauri::{AppHandle, State};
use serde_json::{json, Value as JsonValue};
use crate::state::AppState;
use crate::error::{AppError, Result};
use crate::services::session_manager::CreateSessionRequest;

#[tauri::command]
pub async fn session_create(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: CreateSessionRequest,
) -> Result<JsonValue> {
    // Handle git worktree creation if requested
    let (worktree_path, worktree_branch) = if payload.use_worktree.unwrap_or(false) {
        let settings = state.settings.lock().unwrap();
        let worktree_base_dir = settings.get().git.worktree_base_dir.clone();
        let git = state.git.lock().unwrap();

        // Use a short session ID for branch name
        let short_id = &uuid::Uuid::new_v4().to_string()[..8];

        match git.create_worktree(
            &payload.working_dir,
            short_id,
            None,
            payload.branch_name.as_deref(),
            worktree_base_dir.as_deref(),
        ) {
            Ok(wt) => (Some(wt.path), Some(wt.branch)),
            Err(e) => {
                log::warn!("Failed to create worktree: {}", e);
                (None, None)
            }
        }
    } else {
        (None, None)
    };

    let settings = state.settings.lock().unwrap();
    let thread_store = state.thread_store.lock().unwrap();
    let mut agents = state.agents.lock().unwrap();
    let mut sessions = state.sessions.lock().unwrap();

    let session = sessions.create_session(
        payload,
        &mut agents,
        &*settings,
        &*thread_store,
        worktree_path,
        worktree_branch,
        &app,
    ).await.map_err(|e| AppError::Other(e))?;

    serde_json::to_value(session).map_err(AppError::Json)
}

#[tauri::command]
pub async fn session_prompt(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    content: JsonValue,
    mode: Option<String>,
) -> Result<JsonValue> {
    let settings = state.settings.lock().unwrap();
    let thread_store = state.thread_store.lock().unwrap();
    let mut agents = state.agents.lock().unwrap();
    let mut sessions = state.sessions.lock().unwrap();

    let stop_reason = sessions.prompt(
        &session_id,
        content,
        mode,
        &mut agents,
        &*settings,
        &*thread_store,
        &app,
    ).await.map_err(|e| AppError::Other(e))?;

    Ok(json!({ "stopReason": stop_reason }))
}

#[tauri::command]
pub async fn session_cancel(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<()> {
    let agents = state.agents.lock().unwrap();
    let mut sessions = state.sessions.lock().unwrap();
    sessions.cancel(&session_id, &*agents).map_err(|e| AppError::Other(e))
}

#[tauri::command]
pub async fn session_list(state: State<'_, AppState>) -> Result<JsonValue> {
    let sessions = state.sessions.lock().unwrap();
    let list = sessions.list_sessions();
    serde_json::to_value(list).map_err(AppError::Json)
}

#[tauri::command]
pub async fn session_list_persisted(state: State<'_, AppState>) -> Result<JsonValue> {
    let thread_store = state.thread_store.lock().unwrap();
    let threads = thread_store.load_all();
    serde_json::to_value(threads).map_err(AppError::Json)
}

#[tauri::command]
pub async fn session_remove(
    state: State<'_, AppState>,
    session_id: String,
    cleanup_worktree: bool,
) -> Result<()> {
    let thread_store = state.thread_store.lock().unwrap();
    let mut agents = state.agents.lock().unwrap();
    let mut sessions = state.sessions.lock().unwrap();

    // Get worktree info before removing
    let worktree_info = sessions.get_session(&session_id)
        .and_then(|s| s.worktree_path.as_ref().map(|p| (p.clone(), s.use_worktree.unwrap_or(false))));

    sessions.remove_session(&session_id, &mut agents, &*thread_store);

    // Cleanup worktree if requested
    if cleanup_worktree {
        if let Some((wt_path, use_wt)) = worktree_info {
            if use_wt {
                let git = state.git.lock().unwrap();
                // Find workspace path
                let workspaces = state.workspaces.lock().unwrap();
                // Try to find the parent project path
                if let Some(parent) = std::path::Path::new(&wt_path).parent().and_then(|p| p.parent()) {
                    let _ = git.remove_worktree(&parent.to_string_lossy(), &wt_path);
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn session_permission_response(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
    option_id: String,
) -> Result<()> {
    let agents = state.agents.lock().unwrap();
    let mut sessions = state.sessions.lock().unwrap();
    sessions.resolve_permission(&request_id, &option_id, &*agents, &app);
    Ok(())
}

#[tauri::command]
pub async fn session_rebuild_cache(state: State<'_, AppState>) -> Result<JsonValue> {
    let workspaces = state.workspaces.lock().unwrap();
    let thread_store = state.thread_store.lock().unwrap();

    let workspace_list: Vec<(String, String)> = workspaces.list()
        .into_iter()
        .map(|w| (w.id, w.path))
        .collect();

    thread_store.rebuild_cache(&workspace_list);
    let threads = thread_store.load_all();

    Ok(json!({ "threadCount": threads.len() }))
}

#[tauri::command]
pub async fn session_set_mode(
    state: State<'_, AppState>,
    session_id: String,
    mode_id: String,
) -> Result<()> {
    let mut agents = state.agents.lock().unwrap();
    let mut sessions = state.sessions.lock().unwrap();
    sessions.set_mode(&session_id, &mode_id, &mut agents).await
        .map_err(|e| AppError::Other(e))
}

#[tauri::command]
pub async fn session_set_interaction_mode(
    state: State<'_, AppState>,
    session_id: String,
    mode: String,
) -> Result<()> {
    let thread_store = state.thread_store.lock().unwrap();
    let mut agents = state.agents.lock().unwrap();
    let mut sessions = state.sessions.lock().unwrap();

    if let Some(session) = sessions.get_session(&session_id) {
        let _ = thread_store.update_interaction_mode(&session_id, &session.working_dir, &mode);
    }

    // Try to set mode on the agent if connected
    let _ = sessions.set_mode(&session_id, &mode, &mut agents).await;
    Ok(())
}

#[tauri::command]
pub async fn session_rename(
    state: State<'_, AppState>,
    session_id: String,
    title: String,
) -> Result<()> {
    let thread_store = state.thread_store.lock().unwrap();
    let mut sessions = state.sessions.lock().unwrap();
    sessions.rename(&session_id, &title, &*thread_store);
    Ok(())
}

#[tauri::command]
pub async fn session_set_model(
    state: State<'_, AppState>,
    session_id: String,
    model_id: String,
) -> Result<()> {
    let mut agents = state.agents.lock().unwrap();
    let mut sessions = state.sessions.lock().unwrap();
    sessions.set_model(&session_id, &model_id, &mut agents).await
        .map_err(|e| AppError::Other(e))
}

#[tauri::command]
pub async fn session_set_config_option(
    state: State<'_, AppState>,
    session_id: String,
    config_id: String,
    value: String,
) -> Result<JsonValue> {
    let mut agents = state.agents.lock().unwrap();
    let mut sessions = state.sessions.lock().unwrap();
    sessions.set_config_option(&session_id, &config_id, &value, &mut agents).await
        .map_err(|e| AppError::Other(e))
}

#[tauri::command]
pub async fn session_generate_title(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<String>> {
    // Title generation requires running a summarization agent
    // For now, return None (unimplemented)
    log::info!("session_generate_title: not yet implemented for {}", session_id);
    Ok(None)
}

#[tauri::command]
pub async fn session_fork(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    title: Option<String>,
) -> Result<JsonValue> {
    // Session fork - simplified implementation
    let sessions = state.sessions.lock().unwrap();
    let source = sessions.get_session(&session_id)
        .ok_or_else(|| AppError::SessionNotFound(session_id.clone()))?;

    let new_session = crate::services::session_manager::SessionInfo {
        session_id: uuid::Uuid::new_v4().to_string(),
        connection_id: source.connection_id.clone(),
        agent_id: source.agent_id.clone(),
        agent_name: source.agent_name.clone(),
        title: title.unwrap_or_else(|| format!("Fork of {}", source.title)),
        created_at: chrono::Utc::now().to_rfc3339(),
        worktree_path: source.worktree_path.clone(),
        worktree_branch: source.worktree_branch.clone(),
        working_dir: source.working_dir.clone(),
        status: "active".to_string(),
        messages: source.messages.clone(),
        interaction_mode: source.interaction_mode.clone(),
        use_worktree: source.use_worktree,
        workspace_id: source.workspace_id.clone(),
        parent_session_id: Some(session_id.clone()),
        branch_name: None,
    };

    serde_json::to_value(new_session).map_err(AppError::Json)
}

#[tauri::command]
pub async fn session_ensure_connected(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<JsonValue> {
    let sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get_session(&session_id) {
        let agents = state.agents.lock().unwrap();
        if agents.connections.contains_key(&session.connection_id) {
            return Ok(json!({ "connectionId": session.connection_id }));
        }
    }

    // Need to re-launch; for now return error
    Err(AppError::Other(format!("Session {} is not connected", session_id)))
}

#[tauri::command]
pub async fn session_rename_branch(
    state: State<'_, AppState>,
    session_id: String,
    new_branch: String,
) -> Result<String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get_session(&session_id)
        .ok_or_else(|| AppError::SessionNotFound(session_id.clone()))?;

    let worktree_path = session.worktree_path.as_deref()
        .ok_or_else(|| AppError::Other("Session has no worktree".to_string()))?;

    let git = state.git.lock().unwrap();
    git.rename_branch(worktree_path, &new_branch).map_err(AppError::Git)
}
