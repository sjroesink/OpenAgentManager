use tauri::State;
use serde_json::Value as JsonValue;
use crate::state::AppState;
use crate::error::{AppError, Result};

#[tauri::command]
pub async fn git_status(state: State<'_, AppState>, project_path: String) -> Result<JsonValue> {
    let git = state.git.lock().unwrap();
    let status = git.get_status(&project_path).map_err(|e| AppError::Git(e))?;
    serde_json::to_value(status).map_err(AppError::Json)
}

#[tauri::command]
pub async fn git_create_worktree(
    state: State<'_, AppState>,
    base_path: String,
    session_id: String,
    base_branch: Option<String>,
) -> Result<JsonValue> {
    let settings = state.settings.lock().unwrap();
    let worktree_base_dir = settings.get().git.worktree_base_dir.clone();
    let git = state.git.lock().unwrap();

    let wt = git.create_worktree(
        &base_path,
        &session_id,
        base_branch.as_deref(),
        None,
        worktree_base_dir.as_deref(),
    ).map_err(|e| AppError::Git(e))?;

    serde_json::to_value(wt).map_err(AppError::Json)
}

#[tauri::command]
pub async fn git_remove_worktree(
    state: State<'_, AppState>,
    project_path: String,
    worktree_path: String,
) -> Result<()> {
    let git = state.git.lock().unwrap();
    git.remove_worktree(&project_path, &worktree_path).map_err(|e| AppError::Git(e))
}

#[tauri::command]
pub async fn git_list_worktrees(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<JsonValue> {
    let git = state.git.lock().unwrap();
    let worktrees = git.list_worktrees(&project_path).map_err(|e| AppError::Git(e))?;
    serde_json::to_value(worktrees).map_err(AppError::Json)
}

#[tauri::command]
pub async fn git_commit(
    state: State<'_, AppState>,
    worktree_path: String,
    message: String,
    files: Vec<String>,
) -> Result<JsonValue> {
    let git = state.git.lock().unwrap();
    let result = git.commit(&worktree_path, &message, &files).map_err(|e| AppError::Git(e))?;
    serde_json::to_value(result).map_err(AppError::Json)
}

#[tauri::command]
pub async fn git_diff(
    state: State<'_, AppState>,
    worktree_path: String,
    file_path: Option<String>,
) -> Result<JsonValue> {
    let git = state.git.lock().unwrap();
    let result = git.get_diff(&worktree_path, file_path.as_deref()).map_err(|e| AppError::Git(e))?;
    serde_json::to_value(result).map_err(AppError::Json)
}

#[tauri::command]
pub async fn git_rename_branch(
    state: State<'_, AppState>,
    worktree_path: String,
    new_branch: String,
) -> Result<String> {
    let git = state.git.lock().unwrap();
    git.rename_branch(&worktree_path, &new_branch).map_err(|e| AppError::Git(e))
}
