use std::path::PathBuf;
use std::sync::Mutex;

use crate::services::{
    agent_manager::AgentManager,
    download_service::DownloadService,
    git_service::GitService,
    registry_service::RegistryService,
    session_manager::SessionManager,
    settings_service::SettingsService,
    terminal_service::TerminalService,
    thread_store::ThreadStore,
    workspace_service::WorkspaceService,
};

pub struct AppState {
    pub settings: Mutex<SettingsService>,
    pub workspaces: Mutex<WorkspaceService>,
    pub thread_store: Mutex<ThreadStore>,
    pub registry: Mutex<RegistryService>,
    pub download: Mutex<DownloadService>,
    pub git: Mutex<GitService>,
    pub agents: Mutex<AgentManager>,
    pub sessions: Mutex<SessionManager>,
    pub terminals: Mutex<TerminalService>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        let settings = SettingsService::new(&data_dir);
        let workspaces = WorkspaceService::new(&data_dir);
        let thread_store = ThreadStore::new(&data_dir);
        let registry = RegistryService::new(&data_dir);
        let download = DownloadService::new(&data_dir);
        let git = GitService::new(&data_dir);
        let mut agents = AgentManager::new();
        let sessions = SessionManager::new();
        let terminals = TerminalService::new();

        // Load installed agents
        agents.load_installed(&settings);

        Self {
            settings: Mutex::new(settings),
            workspaces: Mutex::new(workspaces),
            thread_store: Mutex::new(thread_store),
            registry: Mutex::new(registry),
            download: Mutex::new(download),
            git: Mutex::new(git),
            agents: Mutex::new(agents),
            sessions: Mutex::new(sessions),
            terminals: Mutex::new(terminals),
        }
    }
}
