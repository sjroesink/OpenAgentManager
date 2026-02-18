use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use uuid::Uuid;
use log::{info, warn};
use tauri::AppHandle;

use super::acp_client::AcpClient;
use super::settings_service::SettingsService;
use super::registry_service::RegistryService;
use super::download_service::DownloadService;

// ============================================================
// Agent Types (mirrors src/shared/types/agent.ts)
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAgent {
    pub registry_id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub installed_at: String,
    pub distribution_type: String, // "npx" | "uvx" | "binary"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub npx_package: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uvx_package: Option<String>,
    pub icon: String,
    pub authors: Vec<String>,
    pub license: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConnection {
    pub connection_id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<JsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_methods: Option<Vec<JsonValue>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct AgentManager {
    installed: HashMap<String, InstalledAgent>,
    connections: HashMap<String, AcpClient>,
}

// Agent-specific API key env var mapping
fn get_api_key_env_vars(agent_id: &str) -> Vec<String> {
    match agent_id {
        "claude-code" => vec!["ANTHROPIC_API_KEY".to_string()],
        "copilot" | "github-copilot" => vec!["GH_COPILOT_TOKEN".to_string(), "GITHUB_TOKEN".to_string()],
        "gpt" | "openai" => vec!["OPENAI_API_KEY".to_string()],
        "gemini" | "google" => vec!["GOOGLE_API_KEY".to_string(), "GEMINI_API_KEY".to_string()],
        _ => vec![],
    }
}

impl AgentManager {
    pub fn new() -> Self {
        Self {
            installed: HashMap::new(),
            connections: HashMap::new(),
        }
    }

    pub fn load_installed(&mut self, settings: &SettingsService) {
        let agents = settings.load_installed_agents();
        for (id, val) in agents {
            if let Ok(agent) = serde_json::from_value::<InstalledAgent>(val) {
                self.installed.insert(id, agent);
            }
        }
    }

    pub fn save_installed(&self, settings: &SettingsService) {
        let map: HashMap<String, JsonValue> = self.installed.iter()
            .filter_map(|(id, a)| {
                serde_json::to_value(a).ok().map(|v| (id.clone(), v))
            })
            .collect();
        let _ = settings.save_installed_agents(&map);
    }

    pub async fn install(
        &mut self,
        agent_id: &str,
        registry: &RegistryService,
        download: &DownloadService,
        settings: &SettingsService,
    ) -> Result<InstalledAgent, String> {
        let reg = registry.fetch().await
            .map_err(|e| format!("Failed to fetch registry: {}", e))?;

        let registry_agent = reg.agents.iter()
            .find(|a| a.id == agent_id)
            .ok_or_else(|| format!("Agent not found in registry: {}", agent_id))?;

        let installed = if let Some(npx) = &registry_agent.distribution.npx {
            InstalledAgent {
                registry_id: registry_agent.id.clone(),
                name: registry_agent.name.clone(),
                version: registry_agent.version.clone(),
                description: registry_agent.description.clone(),
                installed_at: chrono::Utc::now().to_rfc3339(),
                distribution_type: "npx".to_string(),
                npx_package: Some(npx.package.clone()),
                executable_path: None,
                uvx_package: None,
                icon: registry_agent.icon.clone(),
                authors: registry_agent.authors.clone(),
                license: registry_agent.license.clone(),
            }
        } else if let Some(uvx) = &registry_agent.distribution.uvx {
            InstalledAgent {
                registry_id: registry_agent.id.clone(),
                name: registry_agent.name.clone(),
                version: registry_agent.version.clone(),
                description: registry_agent.description.clone(),
                installed_at: chrono::Utc::now().to_rfc3339(),
                distribution_type: "uvx".to_string(),
                uvx_package: Some(uvx.package.clone()),
                executable_path: None,
                npx_package: None,
                icon: registry_agent.icon.clone(),
                authors: registry_agent.authors.clone(),
                license: registry_agent.license.clone(),
            }
        } else if let Some(binary) = &registry_agent.distribution.binary {
            let platform = get_platform_target()
                .ok_or("Unsupported platform for binary agent")?;
            let target = binary[platform].clone();
            if target.is_null() {
                return Err(format!("No binary for platform: {}", platform));
            }
            let archive_url = target["archive"].as_str()
                .ok_or("Missing archive URL")?;
            let cmd = target["cmd"].as_str()
                .unwrap_or(&registry_agent.id);

            let exec_path = download.download_and_extract(
                agent_id,
                &registry_agent.version,
                archive_url,
                cmd,
            ).await?;

            InstalledAgent {
                registry_id: registry_agent.id.clone(),
                name: registry_agent.name.clone(),
                version: registry_agent.version.clone(),
                description: registry_agent.description.clone(),
                installed_at: chrono::Utc::now().to_rfc3339(),
                distribution_type: "binary".to_string(),
                executable_path: Some(exec_path),
                npx_package: None,
                uvx_package: None,
                icon: registry_agent.icon.clone(),
                authors: registry_agent.authors.clone(),
                license: registry_agent.license.clone(),
            }
        } else {
            return Err(format!("No supported distribution for agent: {}", agent_id));
        };

        self.installed.insert(agent_id.to_string(), installed.clone());
        self.save_installed(settings);

        info!("Agent installed: {} ({})", installed.name, installed.distribution_type);
        Ok(installed)
    }

    pub fn uninstall(&mut self, agent_id: &str, settings: &SettingsService) {
        // Terminate any active connections
        let to_terminate: Vec<String> = self.connections.iter()
            .filter(|(_, c)| c.agent_id == agent_id)
            .map(|(id, _)| id.clone())
            .collect();
        for conn_id in to_terminate {
            if let Some(client) = self.connections.remove(&conn_id) {
                client.terminate();
            }
        }

        self.installed.remove(agent_id);
        self.save_installed(settings);
    }

    pub fn list_installed(&self) -> Vec<InstalledAgent> {
        self.installed.values().cloned().collect()
    }

    pub async fn launch(
        &mut self,
        agent_id: &str,
        project_path: &str,
        extra_env: Option<HashMap<String, String>>,
        settings: &SettingsService,
        registry: &RegistryService,
        app_handle: &AppHandle,
    ) -> Result<AgentConnection, String> {
        let agent = self.installed.get(agent_id)
            .ok_or_else(|| format!("Agent not installed: {}", agent_id))?
            .clone();

        // Resolve spawn command
        let reg_agent = registry.get_cached()
            .and_then(|r| r.agents.into_iter().find(|a| a.id == agent_id));

        let (command, args, base_env) = resolve_spawn_command(&agent, reg_agent.as_ref());

        // Build final env
        let agent_settings = settings.get_agent_settings(agent_id);
        let mut final_env: HashMap<String, String> = base_env;

        // Add API keys from agent settings
        for env_var in get_api_key_env_vars(agent_id) {
            if let Some(ref s) = agent_settings {
                if let Some(ref keys) = s.api_keys {
                    if let Some(val) = keys.get(&env_var) {
                        final_env.insert(env_var, val.clone());
                        continue;
                    }
                }
                // Backward compat: legacy single api_key
                if let Some(ref key) = s.api_key {
                    final_env.insert(env_var, key.clone());
                }
            }
        }

        // Custom env
        if let Some(ref s) = agent_settings {
            if let Some(ref custom_env) = s.custom_env {
                final_env.extend(custom_env.clone());
            }
        }

        // Extra env with blocklist
        if let Some(extra) = extra_env {
            const BLOCKLIST: &[&str] = &[
                "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
                "NODE_OPTIONS", "NODE_DEBUG",
            ];
            for (k, v) in extra {
                if BLOCKLIST.iter().any(|b| b.eq_ignore_ascii_case(&k)) {
                    warn!("Blocked env var: {}", k);
                    continue;
                }
                final_env.insert(k, v);
            }
        }

        // Custom args
        let mut final_args = args.clone();
        if let Some(ref s) = agent_settings {
            if let Some(ref custom_args) = s.custom_args {
                final_args.extend(custom_args.clone());
            }
        }

        info!("Launching {} with: {} {}", agent_id, command, final_args.join(" "));

        // Emit launching status
        let temp_conn_id = Uuid::new_v4().to_string();
        let _ = app_handle.emit("agent:status-change", json!({
            "connectionId": temp_conn_id,
            "status": "launching"
        }));

        let mut client = AcpClient::start(
            agent_id.to_string(),
            command,
            final_args,
            final_env,
            project_path.to_string(),
            app_handle.clone(),
        ).await?;

        client.initialize().await?;

        let conn_id = client.connection_id.clone();
        let agent_name = client.agent_name.clone();
        let capabilities = client.capabilities.clone();
        let auth_methods = client.auth_methods.clone();

        // Auto-authenticate if env_var auth method available
        if let Some(ref s) = agent_settings {
            for method in &client.auth_methods {
                if method["type"].as_str() == Some("env_var") {
                    if let Some(var_name) = method["varName"].as_str() {
                        let api_key = s.api_keys.as_ref()
                            .and_then(|m| m.get(var_name).cloned())
                            .or_else(|| s.api_key.clone());

                        if let Some(key) = api_key {
                            let method_id = method["id"].as_str().unwrap_or("env_var");
                            let mut creds = HashMap::new();
                            creds.insert(var_name.to_string(), key);
                            if let Err(e) = client.authenticate(method_id, Some(&creds)).await {
                                warn!("Auto-auth failed for {}: {}", method_id, e);
                            }
                        }
                    }
                }
            }
        }

        let _ = app_handle.emit("agent:status-change", json!({
            "connectionId": conn_id,
            "status": "connected"
        }));

        let connection = AgentConnection {
            connection_id: conn_id.clone(),
            agent_id: agent_id.to_string(),
            agent_name,
            status: "connected".to_string(),
            pid: None,
            started_at: chrono::Utc::now().to_rfc3339(),
            capabilities,
            auth_methods: Some(auth_methods),
            error: None,
        };

        self.connections.insert(conn_id, client);
        Ok(connection)
    }

    pub fn terminate(&mut self, connection_id: &str) {
        if let Some(client) = self.connections.remove(connection_id) {
            client.terminate();
        }
    }

    pub fn get_client_mut(&mut self, connection_id: &str) -> Option<&mut AcpClient> {
        self.connections.get_mut(connection_id)
    }

    pub fn find_client_for_agent(&self, agent_id: &str) -> Option<&AcpClient> {
        self.connections.values().find(|c| c.agent_id == agent_id)
    }

    pub fn list_connections(&self) -> Vec<AgentConnection> {
        self.connections.values().map(|c| AgentConnection {
            connection_id: c.connection_id.clone(),
            agent_id: c.agent_id.clone(),
            agent_name: c.agent_name.clone(),
            status: "connected".to_string(),
            pid: None,
            started_at: String::new(),
            capabilities: c.capabilities.clone(),
            auth_methods: Some(c.auth_methods.clone()),
            error: None,
        }).collect()
    }

    pub async fn authenticate(
        &mut self,
        connection_id: &str,
        method: &str,
        credentials: Option<HashMap<String, String>>,
        app_handle: &AppHandle,
    ) -> Result<(), String> {
        let client = self.connections.get(connection_id)
            .ok_or_else(|| format!("Connection not found: {}", connection_id))?;
        client.authenticate(method, credentials.as_ref()).await?;
        let _ = app_handle.emit("agent:status-change", json!({
            "connectionId": connection_id,
            "status": "connected"
        }));
        Ok(())
    }

    pub async fn logout(&mut self, connection_id: &str) -> Result<(), String> {
        let client = self.connections.get(connection_id)
            .ok_or_else(|| format!("Connection not found: {}", connection_id))?;
        client.logout().await
    }

    pub fn detect_cli_commands(&self, commands: &[String]) -> HashMap<String, bool> {
        commands.iter().map(|cmd| {
            let found = which::which(cmd).is_ok();
            (cmd.clone(), found)
        }).collect()
    }
}

fn resolve_spawn_command(
    agent: &InstalledAgent,
    registry_agent: Option<&super::registry_service::AcpRegistryAgent>,
) -> (String, Vec<String>, HashMap<String, String>) {
    let empty_env = HashMap::new();

    match agent.distribution_type.as_str() {
        "npx" => {
            let package = agent.npx_package.as_deref().unwrap_or("");
            let npx_cmd = get_npx_command();
            let registry_args = registry_agent
                .and_then(|a| a.distribution.npx.as_ref())
                .and_then(|n| n.args.as_ref())
                .cloned()
                .unwrap_or_default();
            let registry_env = registry_agent
                .and_then(|a| a.distribution.npx.as_ref())
                .and_then(|n| n.env.as_ref())
                .cloned()
                .unwrap_or_default();

            let has_yes = registry_args.iter().any(|a| a == "-y" || a == "--yes");
            let mut args = if has_yes { vec![] } else { vec!["-y".to_string()] };
            args.push(package.to_string());
            args.extend(registry_args);

            (npx_cmd, args, registry_env)
        }
        "uvx" => {
            let package = agent.uvx_package.as_deref().unwrap_or("");
            let uvx_cmd = get_uvx_command();
            let registry_args = registry_agent
                .and_then(|a| a.distribution.uvx.as_ref())
                .and_then(|n| n.args.as_ref())
                .cloned()
                .unwrap_or_default();
            let registry_env = registry_agent
                .and_then(|a| a.distribution.uvx.as_ref())
                .and_then(|n| n.env.as_ref())
                .cloned()
                .unwrap_or_default();

            let mut args = vec![package.to_string()];
            args.extend(registry_args);

            (uvx_cmd, args, registry_env)
        }
        "binary" => {
            let exec = agent.executable_path.as_deref().unwrap_or("");
            let registry_args = registry_agent
                .and_then(|a| a.distribution.binary.as_ref())
                .and_then(|b| {
                    let platform = get_platform_target()?;
                    b[platform]["args"].as_array().map(|arr| {
                        arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
                    })
                })
                .unwrap_or_default();

            (exec.to_string(), registry_args, HashMap::new())
        }
        _ => (String::new(), vec![], HashMap::new()),
    }
}

fn get_npx_command() -> String {
    if cfg!(target_os = "windows") {
        "npx.cmd".to_string()
    } else {
        "npx".to_string()
    }
}

fn get_uvx_command() -> String {
    "uvx".to_string()
}

fn get_platform_target() -> Option<&'static str> {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            Some("darwin-aarch64")
        } else {
            Some("darwin-x86_64")
        }
    } else if cfg!(target_os = "linux") {
        if cfg!(target_arch = "aarch64") {
            Some("linux-aarch64")
        } else {
            Some("linux-x86_64")
        }
    } else if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") {
            Some("windows-aarch64")
        } else {
            Some("windows-x86_64")
        }
    } else {
        None
    }
}
