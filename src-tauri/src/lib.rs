mod commands;
mod error;
mod services;
mod state;

use state::AppState;
use commands::{
    agent::*, file::*, git::*, registry::*, session::*, settings::*, system::*, terminal::*,
    window::*, workspace::*,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = dirs::data_dir()
        .map(|d| d.join("OpenAgentManager"))
        .unwrap_or_else(|| std::path::PathBuf::from(".agent-data"));

    std::fs::create_dir_all(&data_dir).expect("Failed to create data directory");

    let app_state = AppState::new(data_dir);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // Registry
            registry_fetch,
            registry_get_cached,
            registry_get_icon_svg,
            // Agent
            agent_install,
            agent_uninstall,
            agent_list_installed,
            agent_launch,
            agent_check_auth,
            agent_terminate,
            agent_authenticate,
            agent_logout,
            agent_list_connections,
            agent_get_models,
            agent_get_modes,
            agent_detect_cli,
            // Session
            session_create,
            session_prompt,
            session_cancel,
            session_list,
            session_list_persisted,
            session_remove,
            session_permission_response,
            session_rebuild_cache,
            session_set_mode,
            session_set_interaction_mode,
            session_rename,
            session_set_model,
            session_set_config_option,
            session_generate_title,
            session_fork,
            session_ensure_connected,
            session_rename_branch,
            // Files
            file_read_tree,
            file_read,
            file_get_changes,
            project_open,
            project_select_directory,
            // Git
            git_status,
            git_create_worktree,
            git_remove_worktree,
            git_list_worktrees,
            git_commit,
            git_diff,
            git_rename_branch,
            // Terminal
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_kill,
            // Workspace
            workspace_list,
            workspace_create,
            workspace_remove,
            workspace_update,
            workspace_select_directory,
            workspace_open_in_vscode,
            workspace_open_directory,
            workspace_get_config,
            workspace_set_config,
            // Settings
            settings_get,
            settings_set,
            settings_set_agent,
            // System
            system_wsl_info,
            // Window
            window_reload,
            window_toggle_devtools,
            window_reset_zoom,
            window_zoom_in,
            window_zoom_out,
            window_toggle_fullscreen,
            window_minimize,
            window_close,
            window_quit,
        ])
        .setup(|app| {
            // Rebuild thread cache from workspaces on startup
            let state = app.state::<AppState>();
            let workspaces = state.workspaces.lock().unwrap();
            let thread_store = state.thread_store.lock().unwrap();
            let workspace_list: Vec<(String, String)> = workspaces.list()
                .into_iter()
                .map(|w| (w.id, w.path))
                .collect();
            thread_store.rebuild_cache(&workspace_list);
            drop(workspaces);
            drop(thread_store);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running OpenAgentManager");
}
