use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use uuid::Uuid;
use log::{info, warn};
use tauri::AppHandle;
use chrono::Utc;

use super::agent_manager::AgentManager;
use super::settings_service::SettingsService;
use super::thread_store::ThreadStore;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub connection_id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub title: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_branch: Option<String>,
    pub working_dir: String,
    pub status: String,
    pub messages: Vec<JsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interaction_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_worktree: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub connection_id: String,
    pub working_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_worktree: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interaction_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
}

pub struct SessionManager {
    sessions: HashMap<String, SessionInfo>,
    pending_permissions: HashMap<String, JsonValue>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            pending_permissions: HashMap::new(),
        }
    }

    pub async fn create_session(
        &mut self,
        request: CreateSessionRequest,
        agents: &mut AgentManager,
        settings: &SettingsService,
        thread_store: &ThreadStore,
        git_worktree_path: Option<String>,
        git_worktree_branch: Option<String>,
        app_handle: &AppHandle,
    ) -> Result<SessionInfo, String> {
        let client = agents.get_client_mut(&request.connection_id)
            .ok_or_else(|| format!("Agent connection not found: {}", request.connection_id))?;

        let session_id = Uuid::new_v4().to_string();
        let session_local_id = &session_id[..8];

        let working_dir = git_worktree_path.as_deref()
            .unwrap_or(&request.working_dir)
            .to_string();

        // Get enabled MCP servers
        let mcp_servers = get_enabled_mcp_servers(settings);

        // Create ACP session
        client.new_session(
            &working_dir,
            mcp_servers,
            Some(&session_id),
            request.interaction_mode.as_deref(),
            app_handle,
        ).await?;

        // Set mode/model
        if let Some(ref mode) = request.interaction_mode {
            if let Err(e) = client.set_mode(&session_id, mode).await {
                warn!("Failed to set mode: {}", e);
            }
        }
        if let Some(ref model) = request.model_id {
            if let Err(e) = client.set_model(&session_id, model).await {
                warn!("Failed to set model: {}", e);
            }
        }

        let session = SessionInfo {
            session_id: session_id.clone(),
            connection_id: request.connection_id.clone(),
            agent_id: client.agent_id.clone(),
            agent_name: client.agent_name.clone(),
            title: request.title.unwrap_or_else(|| format!("Session {}", session_local_id)),
            created_at: Utc::now().to_rfc3339(),
            worktree_path: git_worktree_path,
            worktree_branch: git_worktree_branch,
            working_dir,
            status: "active".to_string(),
            messages: vec![],
            interaction_mode: request.interaction_mode,
            use_worktree: request.use_worktree,
            workspace_id: request.workspace_id,
            parent_session_id: None,
            branch_name: request.branch_name,
        };

        // Persist
        let session_value = serde_json::to_value(&session).unwrap_or_default();
        let _ = thread_store.save(&session_value);

        self.sessions.insert(session_id.clone(), session.clone());
        info!("Session created: {} on {}", session_id, client.agent_name);

        Ok(session)
    }

    pub async fn prompt(
        &mut self,
        session_id: &str,
        content: JsonValue,
        mode: Option<String>,
        agents: &mut AgentManager,
        settings: &SettingsService,
        thread_store: &ThreadStore,
        app_handle: &AppHandle,
    ) -> Result<String, String> {
        let session = self.sessions.get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        let connection_id = session.connection_id.clone();
        let working_dir = session.working_dir.clone();

        session.status = "prompting".to_string();

        // Add user message
        let user_msg = json!({
            "id": Uuid::new_v4().to_string(),
            "role": "user",
            "content": content,
            "timestamp": Utc::now().to_rfc3339()
        });
        session.messages.push(user_msg);

        if let Some(ref m) = mode {
            session.interaction_mode = Some(m.clone());
        }

        let client = agents.get_client_mut(&connection_id)
            .ok_or_else(|| format!("Agent connection lost for session: {}", session_id))?;

        let result = client.prompt(session_id, content, mode.as_deref()).await;

        let session = self.sessions.get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        match &result {
            Ok(_) => session.status = "active".to_string(),
            Err(_) => session.status = "error".to_string(),
        }

        // Persist messages
        let messages = session.messages.clone();
        let _ = thread_store.update_messages(
            session_id,
            &session.working_dir,
            &json!(messages),
        );

        result
    }

    pub fn cancel(&mut self, session_id: &str, agents: &AgentManager) -> Result<(), String> {
        let session = self.sessions.get(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        // Cancel any pending permissions for this session
        let to_cancel: Vec<String> = self.pending_permissions.iter()
            .filter(|(_, p)| p["sessionId"].as_str() == Some(session_id))
            .map(|(id, _)| id.clone())
            .collect();

        for req_id in to_cancel {
            if let Some(conn) = agents.connections.get(&session.connection_id) {
                conn.resolve_permission(&req_id, "__cancelled__");
            }
            self.pending_permissions.remove(&req_id);
        }

        // Cancel via ACP
        if let Some(client) = agents.connections.get(&session.connection_id) {
            client.cancel(session_id);
        }

        if let Some(s) = self.sessions.get_mut(session_id) {
            s.status = "cancelled".to_string();
        }

        Ok(())
    }

    pub fn resolve_permission(
        &mut self,
        request_id: &str,
        option_id: &str,
        agents: &AgentManager,
        app_handle: &AppHandle,
    ) {
        self.pending_permissions.remove(request_id);

        let _ = app_handle.emit("session:permission-resolved", json!({
            "requestId": request_id
        }));

        // Forward to all agent connections
        for client in agents.connections.values() {
            client.resolve_permission(request_id, option_id);
        }
    }

    pub fn get_session(&self, session_id: &str) -> Option<&SessionInfo> {
        self.sessions.get(session_id)
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions.values().cloned().collect()
    }

    pub fn rename(&mut self, session_id: &str, title: &str, thread_store: &ThreadStore) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.title = title.to_string();
            let _ = thread_store.rename(session_id, &session.working_dir, title);
        }
    }

    pub fn remove_session(
        &mut self,
        session_id: &str,
        agents: &mut AgentManager,
        thread_store: &ThreadStore,
    ) {
        if let Some(session) = self.sessions.remove(session_id) {
            agents.terminate(&session.connection_id);
            let _ = thread_store.remove(session_id, &session.working_dir);
        }
    }

    pub async fn set_mode(
        &mut self,
        session_id: &str,
        mode_id: &str,
        agents: &mut AgentManager,
    ) -> Result<(), String> {
        let conn_id = self.sessions.get(session_id)
            .map(|s| s.connection_id.clone())
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        let client = agents.get_client_mut(&conn_id)
            .ok_or_else(|| format!("Connection not found: {}", conn_id))?;
        client.set_mode(session_id, mode_id).await
    }

    pub async fn set_model(
        &mut self,
        session_id: &str,
        model_id: &str,
        agents: &mut AgentManager,
    ) -> Result<(), String> {
        let conn_id = self.sessions.get(session_id)
            .map(|s| s.connection_id.clone())
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        let client = agents.get_client_mut(&conn_id)
            .ok_or_else(|| format!("Connection not found: {}", conn_id))?;
        client.set_model(session_id, model_id).await
    }

    pub async fn set_config_option(
        &mut self,
        session_id: &str,
        config_id: &str,
        value: &str,
        agents: &mut AgentManager,
    ) -> Result<JsonValue, String> {
        let conn_id = self.sessions.get(session_id)
            .map(|s| s.connection_id.clone())
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        let client = agents.get_client_mut(&conn_id)
            .ok_or_else(|| format!("Connection not found: {}", conn_id))?;
        client.set_config_option(session_id, config_id, value).await
    }
}

fn get_enabled_mcp_servers(settings: &SettingsService) -> Vec<JsonValue> {
    settings.get().mcp.servers.iter()
        .filter(|s| s.enabled)
        .map(|s| {
            let mut obj = json!({
                "name": s.name,
                "transport": s.transport
            });
            if let Some(ref cmd) = s.command { obj["command"] = json!(cmd); }
            if let Some(ref args) = s.args { if !args.is_empty() { obj["args"] = json!(args); } }
            if let Some(ref url) = s.url { obj["url"] = json!(url); }
            if let Some(ref env) = s.env { if !env.is_empty() { obj["env"] = json!(env); } }
            obj
        })
        .collect()
}
