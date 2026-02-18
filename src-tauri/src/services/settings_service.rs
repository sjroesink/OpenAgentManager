use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use log::{error, warn};

// ============================================================
// Settings Types (mirrors src/shared/types/settings.ts)
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub general: GeneralSettings,
    pub git: GitSettings,
    pub agents: HashMap<String, AgentSettings>,
    pub mcp: McpSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub theme: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_project_path: Option<String>,
    pub font_size: u32,
    pub show_tool_call_details: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summarization_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summarization_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_shell: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_onboarding: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSettings {
    pub enable_worktrees: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_base_dir: Option<String>,
    pub auto_commit: bool,
    pub commit_prefix: String,
    pub cleanup_worktrees_on_close: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_keys: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_approve_read: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_in_wsl: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wsl_distribution: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSettings {
    pub servers: Vec<McpServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub transport: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
    pub enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            general: GeneralSettings {
                theme: "system".to_string(),
                default_project_path: None,
                font_size: 14,
                show_tool_call_details: true,
                summarization_agent_id: None,
                summarization_model: None,
                terminal_shell: None,
                completed_onboarding: None,
            },
            git: GitSettings {
                enable_worktrees: true,
                worktree_base_dir: None,
                auto_commit: false,
                commit_prefix: "agent: ".to_string(),
                cleanup_worktrees_on_close: false,
            },
            agents: HashMap::new(),
            mcp: McpSettings { servers: vec![] },
        }
    }
}

// ============================================================
// Service
// ============================================================

pub struct SettingsService {
    settings_path: PathBuf,
    installed_agents_path: PathBuf,
}

impl SettingsService {
    pub fn new(data_dir: &PathBuf) -> Self {
        Self {
            settings_path: data_dir.join("settings.json"),
            installed_agents_path: data_dir.join("installed-agents.json"),
        }
    }

    pub fn get(&self) -> AppSettings {
        self.load_settings()
    }

    pub fn set(&self, partial: serde_json::Value) -> Result<(), String> {
        let mut current = self.load_settings();
        self.merge_settings(&mut current, partial);
        self.save_settings(&current)
    }

    pub fn get_agent_settings(&self, agent_id: &str) -> Option<AgentSettings> {
        let settings = self.load_settings();
        settings.agents.get(agent_id).cloned()
    }

    pub fn set_agent_settings(&self, agent_id: &str, agent_settings: serde_json::Value) -> Result<(), String> {
        let mut settings = self.load_settings();
        let current = settings.agents.entry(agent_id.to_string()).or_default();
        // Merge agent settings
        if let Some(obj) = agent_settings.as_object() {
            if let Some(v) = obj.get("apiKeys") {
                if let Ok(keys) = serde_json::from_value::<HashMap<String, String>>(v.clone()) {
                    current.api_keys = Some(keys);
                }
            }
            if let Some(v) = obj.get("apiKey") {
                current.api_key = v.as_str().map(|s| s.to_string());
            }
            if let Some(v) = obj.get("model") {
                current.model = v.as_str().map(|s| s.to_string());
            }
            if let Some(v) = obj.get("customArgs") {
                if let Ok(args) = serde_json::from_value::<Vec<String>>(v.clone()) {
                    current.custom_args = Some(args);
                }
            }
            if let Some(v) = obj.get("customEnv") {
                if let Ok(env) = serde_json::from_value::<HashMap<String, String>>(v.clone()) {
                    current.custom_env = Some(env);
                }
            }
            if let Some(v) = obj.get("runInWsl") {
                current.run_in_wsl = v.as_bool();
            }
            if let Some(v) = obj.get("wslDistribution") {
                current.wsl_distribution = v.as_str().map(|s| s.to_string());
            }
        }
        self.save_settings(&settings)
    }

    pub fn load_installed_agents(&self) -> HashMap<String, serde_json::Value> {
        if !self.installed_agents_path.exists() {
            return HashMap::new();
        }
        match fs::read_to_string(&self.installed_agents_path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => HashMap::new(),
        }
    }

    pub fn save_installed_agents(&self, agents: &HashMap<String, serde_json::Value>) -> Result<(), String> {
        let json = serde_json::to_string_pretty(agents)
            .map_err(|e| e.to_string())?;
        fs::write(&self.installed_agents_path, json)
            .map_err(|e| e.to_string())
    }

    // ============================
    // Private helpers
    // ============================

    fn load_settings(&self) -> AppSettings {
        if !self.settings_path.exists() {
            return AppSettings::default();
        }
        match fs::read_to_string(&self.settings_path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(e) => {
                warn!("Failed to read settings: {}", e);
                AppSettings::default()
            }
        }
    }

    fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        if let Some(parent) = self.settings_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(settings)
            .map_err(|e| e.to_string())?;
        fs::write(&self.settings_path, json)
            .map_err(|e| e.to_string())
    }

    fn merge_settings(&self, settings: &mut AppSettings, partial: serde_json::Value) {
        if let Some(obj) = partial.as_object() {
            if let Some(general) = obj.get("general") {
                if let Some(g) = general.as_object() {
                    if let Some(v) = g.get("theme") {
                        if let Some(s) = v.as_str() {
                            settings.general.theme = s.to_string();
                        }
                    }
                    if let Some(v) = g.get("defaultProjectPath") {
                        settings.general.default_project_path = v.as_str().map(|s| s.to_string());
                    }
                    if let Some(v) = g.get("fontSize") {
                        if let Some(n) = v.as_u64() {
                            settings.general.font_size = n as u32;
                        }
                    }
                    if let Some(v) = g.get("showToolCallDetails") {
                        settings.general.show_tool_call_details = v.as_bool().unwrap_or(true);
                    }
                    if let Some(v) = g.get("summarizationAgentId") {
                        settings.general.summarization_agent_id = v.as_str().map(|s| s.to_string());
                    }
                    if let Some(v) = g.get("summarizationModel") {
                        settings.general.summarization_model = v.as_str().map(|s| s.to_string());
                    }
                    if let Some(v) = g.get("terminalShell") {
                        settings.general.terminal_shell = v.as_str().map(|s| s.to_string());
                    }
                    if let Some(v) = g.get("completedOnboarding") {
                        settings.general.completed_onboarding = v.as_bool();
                    }
                }
            }
            if let Some(git) = obj.get("git") {
                if let Ok(git_settings) = serde_json::from_value::<GitSettings>(git.clone()) {
                    settings.git = git_settings;
                }
            }
            if let Some(agents) = obj.get("agents") {
                if let Ok(agent_map) = serde_json::from_value::<HashMap<String, AgentSettings>>(agents.clone()) {
                    settings.agents = agent_map;
                }
            }
            if let Some(mcp) = obj.get("mcp") {
                if let Ok(mcp_settings) = serde_json::from_value::<McpSettings>(mcp.clone()) {
                    settings.mcp = mcp_settings;
                }
            }
        }
    }
}
