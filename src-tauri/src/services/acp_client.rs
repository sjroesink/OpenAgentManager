use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};
use serde_json::{json, Value as JsonValue};
use uuid::Uuid;
use log::{debug, error, info, warn};
use tauri::AppHandle;

const ACP_PROTOCOL_VERSION: u32 = 1;

type PendingResolver = oneshot::Sender<Result<JsonValue, String>>;
type PermissionResolver = oneshot::Sender<JsonValue>;

pub struct AcpClient {
    pub connection_id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub agent_version: String,
    pub capabilities: Option<JsonValue>,
    pub auth_methods: Vec<JsonValue>,

    next_id: Arc<Mutex<u32>>,
    pending: Arc<Mutex<HashMap<u32, PendingResolver>>>,
    pending_meta: Arc<Mutex<HashMap<u32, String>>>, // method name
    permission_resolvers: Arc<Mutex<HashMap<String, PermissionResolver>>>,
    // remoteId -> internalId, internalId -> remoteId
    session_map: Arc<Mutex<(HashMap<String, String>, HashMap<String, String>)>>,
    stdin: Arc<tokio::sync::Mutex<ChildStdin>>,
    app_handle: AppHandle,
    _child: Arc<Mutex<Option<Child>>>,
}

impl AcpClient {
    /// Spawn the agent process and return an AcpClient
    pub async fn start(
        agent_id: String,
        command: String,
        args: Vec<String>,
        env: HashMap<String, String>,
        cwd: String,
        app_handle: AppHandle,
    ) -> Result<Self, String> {
        info!("Spawning agent: {} {}", command, args.join(" "));

        let mut cmd = Command::new(&command);
        cmd.args(&args)
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        // Set environment variables
        for (k, v) in &env {
            cmd.env(k, v);
        }

        let mut child = cmd.spawn()
            .map_err(|e| format!("Failed to spawn agent '{}': {}", command, e))?;

        let stdin = child.stdin.take()
            .ok_or("Failed to get stdin")?;
        let stdout = child.stdout.take()
            .ok_or("Failed to get stdout")?;
        let stderr = child.stderr.take()
            .ok_or("Failed to get stderr")?;

        let connection_id = Uuid::new_v4().to_string();
        let pending: Arc<Mutex<HashMap<u32, PendingResolver>>> = Arc::new(Mutex::new(HashMap::new()));
        let pending_meta: Arc<Mutex<HashMap<u32, String>>> = Arc::new(Mutex::new(HashMap::new()));
        let permission_resolvers: Arc<Mutex<HashMap<String, PermissionResolver>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let session_map: Arc<Mutex<(HashMap<String, String>, HashMap<String, String>)>> =
            Arc::new(Mutex::new((HashMap::new(), HashMap::new())));

        let pending_clone = Arc::clone(&pending);
        let pending_meta_clone = Arc::clone(&pending_meta);
        let permission_resolvers_clone = Arc::clone(&permission_resolvers);
        let session_map_clone = Arc::clone(&session_map);
        let conn_id_clone = connection_id.clone();
        let agent_id_clone = agent_id.clone();
        let app_handle_clone = app_handle.clone();

        // Spawn stdout reader task
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim().to_string();
                if trimmed.is_empty() { continue; }
                debug!("[{}:recv] {}", agent_id_clone, trimmed);

                match serde_json::from_str::<JsonValue>(&trimmed) {
                    Ok(msg) => {
                        handle_message(
                            msg,
                            &pending_clone,
                            &pending_meta_clone,
                            &permission_resolvers_clone,
                            &session_map_clone,
                            &conn_id_clone,
                            &agent_id_clone,
                            &app_handle_clone,
                        ).await;
                    }
                    Err(_) => {
                        debug!("[{}] Non-JSON stdout: {}", agent_id_clone, trimmed);
                    }
                }
            }

            // Process exited - reject all pending
            let mut locked = pending_clone.lock().unwrap();
            for (_, sender) in locked.drain() {
                let _ = sender.send(Err("Agent process exited".to_string()));
            }
            info!("[{}] stdout reader exited", agent_id_clone);
        });

        // Spawn stderr logger task
        let agent_id_stderr = agent_id.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    warn!("[{}:stderr] {}", agent_id_stderr, trimmed);
                }
            }
        });

        let client = AcpClient {
            connection_id,
            agent_id,
            agent_name: "Unknown Agent".to_string(),
            agent_version: String::new(),
            capabilities: None,
            auth_methods: vec![],
            next_id: Arc::new(Mutex::new(1)),
            pending,
            pending_meta,
            permission_resolvers,
            session_map,
            stdin: Arc::new(tokio::sync::Mutex::new(stdin)),
            app_handle,
            _child: Arc::new(Mutex::new(Some(child))),
        };

        Ok(client)
    }

    /// ACP initialize handshake
    pub async fn initialize(&mut self) -> Result<(), String> {
        let result = self.send_request_timeout("initialize", json!({
            "protocolVersion": ACP_PROTOCOL_VERSION,
            "clientInfo": {
                "name": "AgentManager",
                "title": "Open Agent Manager",
                "version": "1.0.0"
            },
            "clientCapabilities": {
                "fs": { "readTextFile": true, "writeTextFile": true },
                "terminal": true
            }
        }), 30000).await?;

        self.agent_name = result["agentInfo"]["name"]
            .as_str()
            .unwrap_or(&self.agent_id)
            .to_string();
        self.agent_version = result["agentInfo"]["version"]
            .as_str()
            .unwrap_or("")
            .to_string();
        self.capabilities = result.get("agentCapabilities").cloned();
        self.auth_methods = result["authMethods"]
            .as_array()
            .cloned()
            .unwrap_or_default();

        info!(
            "Agent initialized: {} v{}, auth methods: {}",
            self.agent_name,
            self.agent_version,
            self.auth_methods.iter()
                .filter_map(|m| m["id"].as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );

        Ok(())
    }

    /// Authenticate with the agent
    pub async fn authenticate(
        &self,
        method_id: &str,
        credentials: Option<&HashMap<String, String>>,
    ) -> Result<(), String> {
        let mut params = json!({ "authMethodId": method_id });
        if let Some(creds) = credentials {
            for (k, v) in creds {
                params[k] = json!(v);
            }
        }

        // Try modern method first, fall back to legacy
        match self.send_request("connection/authenticate", params.clone()).await {
            Ok(_) => return Ok(()),
            Err(e) if e.contains("-32601") || e.to_lowercase().contains("method not found") => {}
            Err(e) => return Err(e),
        }

        // Legacy method
        let mut legacy_params = json!({ "methodId": method_id });
        if let Some(creds) = credentials {
            for (k, v) in creds {
                legacy_params[k] = json!(v);
            }
        }
        self.send_request("authenticate", legacy_params).await?;
        Ok(())
    }

    /// Create a new ACP session
    pub async fn new_session(
        &self,
        cwd: &str,
        mcp_servers: Vec<JsonValue>,
        internal_session_id: Option<&str>,
        preferred_mode_id: Option<&str>,
        app_handle: &AppHandle,
    ) -> Result<String, String> {
        let result = self.send_request_with_meta(
            "session/new",
            json!({ "cwd": cwd, "mcpServers": mcp_servers }),
            internal_session_id,
        ).await?;

        let remote_id = result["sessionId"].as_str()
            .ok_or("session/new: missing sessionId")?
            .to_string();

        // Register session mapping
        if let Some(internal_id) = internal_session_id {
            let mut map = self.session_map.lock().unwrap();
            map.0.insert(remote_id.clone(), internal_id.to_string());
            map.1.insert(internal_id.to_string(), remote_id.clone());
        }

        let session_id = internal_session_id.unwrap_or(&remote_id).to_string();

        // Emit modes/models/config_options from session/new response
        emit_session_new_updates(&session_id, &result, preferred_mode_id, app_handle);

        Ok(session_id)
    }

    /// Prompt the agent
    pub async fn prompt(
        &self,
        session_id: &str,
        content: JsonValue,
        mode: Option<&str>,
    ) -> Result<String, String> {
        let remote_id = self.internal_to_remote(session_id);
        let mut params = json!({
            "sessionId": remote_id,
            "prompt": content
        });
        if let Some(m) = mode {
            params["interactionMode"] = json!(m);
        }
        let result = self.send_request("session/prompt", params).await?;
        Ok(result["stopReason"].as_str().unwrap_or("end_turn").to_string())
    }

    /// Cancel a running prompt
    pub fn cancel(&self, session_id: &str) {
        let remote_id = self.internal_to_remote(session_id);
        let msg = json!({ "jsonrpc": "2.0", "method": "session/cancel", "params": { "sessionId": remote_id } });
        let stdin = Arc::clone(&self.stdin);
        tokio::spawn(async move {
            let mut stdin = stdin.lock().await;
            let _ = stdin.write_all(format!("{}\n", msg).as_bytes()).await;
        });
    }

    /// Set session mode
    pub async fn set_mode(&self, session_id: &str, mode_id: &str) -> Result<(), String> {
        let remote_id = self.internal_to_remote(session_id);
        self.send_request("session/set_mode", json!({ "sessionId": remote_id, "modeId": mode_id })).await?;
        Ok(())
    }

    /// Set session model
    pub async fn set_model(&self, session_id: &str, model_id: &str) -> Result<(), String> {
        let remote_id = self.internal_to_remote(session_id);
        self.send_request("session/set_model", json!({ "sessionId": remote_id, "modelId": model_id })).await?;
        Ok(())
    }

    /// Set config option
    pub async fn set_config_option(
        &self,
        session_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<JsonValue, String> {
        let remote_id = self.internal_to_remote(session_id);
        self.send_request("session/set_config_option", json!({
            "sessionId": remote_id,
            "configId": config_id,
            "value": value
        })).await
    }

    /// Fork an existing session
    pub async fn fork_session(
        &self,
        source_session_id: &str,
        cwd: &str,
        new_session_id: Option<&str>,
    ) -> Result<String, String> {
        let remote_id = self.internal_to_remote(source_session_id);
        let result = self.send_request("session/fork", json!({
            "sessionId": remote_id,
            "cwd": cwd
        })).await?;

        let new_remote_id = result["sessionId"].as_str()
            .ok_or("session/fork: missing sessionId")?
            .to_string();

        if let Some(internal_id) = new_session_id {
            let mut map = self.session_map.lock().unwrap();
            map.0.insert(new_remote_id.clone(), internal_id.to_string());
            map.1.insert(internal_id.to_string(), new_remote_id.clone());
            return Ok(internal_id.to_string());
        }

        Ok(new_remote_id)
    }

    /// Logout
    pub async fn logout(&self) -> Result<(), String> {
        match self.send_request("connection/logout", json!({})).await {
            Ok(_) => return Ok(()),
            Err(e) if e.contains("-32601") || e.to_lowercase().contains("method not found") => {}
            Err(e) => return Err(e),
        }
        self.send_request("logout", json!({})).await?;
        Ok(())
    }

    /// Resolve a pending permission request
    pub fn resolve_permission(&self, request_id: &str, option_id: &str) {
        let mut resolvers = self.permission_resolvers.lock().unwrap();
        if let Some(sender) = resolvers.remove(request_id) {
            let _ = sender.send(json!({ "optionId": option_id }));
        }
    }

    /// Terminate the agent process
    pub fn terminate(&self) {
        let mut child_lock = self._child.lock().unwrap();
        if let Some(child) = child_lock.take() {
            drop(child); // kill_on_drop will terminate it
        }

        // Reject all pending requests
        let mut locked = self.pending.lock().unwrap();
        for (_, sender) in locked.drain() {
            let _ = sender.send(Err("Agent terminated".to_string()));
        }
    }

    pub fn supports_fork(&self) -> bool {
        self.capabilities
            .as_ref()
            .and_then(|c| c["sessionCapabilities"]["fork"].as_bool())
            .unwrap_or(false)
    }

    // ============================
    // Private: JSON-RPC transport
    // ============================

    async fn send_request(&self, method: &str, params: JsonValue) -> Result<JsonValue, String> {
        self.send_request_with_meta(method, params, None).await
    }

    async fn send_request_with_meta(
        &self,
        method: &str,
        params: JsonValue,
        _internal_session_id: Option<&str>,
    ) -> Result<JsonValue, String> {
        let id = {
            let mut next = self.next_id.lock().unwrap();
            let id = *next;
            *next += 1;
            id
        };

        let (tx, rx) = oneshot::channel();

        {
            let mut pending = self.pending.lock().unwrap();
            pending.insert(id, tx);
        }
        {
            let mut meta = self.pending_meta.lock().unwrap();
            meta.insert(id, method.to_string());
        }

        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        let line = format!("{}\n", msg);
        debug!("[{}:send] {}", self.agent_id, line.trim());

        {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(line.as_bytes()).await
                .map_err(|e| format!("Failed to write to agent stdin: {}", e))?;
            stdin.flush().await
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
        }

        rx.await.map_err(|_| "Request channel closed".to_string())?
    }

    async fn send_request_timeout(
        &self,
        method: &str,
        params: JsonValue,
        timeout_ms: u64,
    ) -> Result<JsonValue, String> {
        timeout(
            Duration::from_millis(timeout_ms),
            self.send_request(method, params),
        )
        .await
        .map_err(|_| format!("Request '{}' timed out after {}ms", method, timeout_ms))?
    }

    fn internal_to_remote(&self, internal_id: &str) -> String {
        let map = self.session_map.lock().unwrap();
        map.1.get(internal_id).cloned().unwrap_or_else(|| internal_id.to_string())
    }
}

// ============================
// Incoming message handler (runs in background task)
// ============================

async fn handle_message(
    msg: JsonValue,
    pending: &Arc<Mutex<HashMap<u32, PendingResolver>>>,
    pending_meta: &Arc<Mutex<HashMap<u32, String>>>,
    permission_resolvers: &Arc<Mutex<HashMap<String, PermissionResolver>>>,
    session_map: &Arc<Mutex<(HashMap<String, String>, HashMap<String, String>)>>,
    connection_id: &str,
    agent_id: &str,
    app_handle: &AppHandle,
) {
    let has_id = msg.get("id").is_some() && !msg["id"].is_null();
    let has_method = msg.get("method").is_some() && msg["method"].is_string();

    if has_id && !has_method {
        // Response to our request
        let id = msg["id"].as_u64().unwrap_or(0) as u32;
        let sender = pending.lock().unwrap().remove(&id);
        let method = pending_meta.lock().unwrap().remove(&id);

        if let Some(tx) = sender {
            if let Some(error) = msg.get("error") {
                let code = error["code"].as_i64().unwrap_or(0);
                let message = error["message"].as_str().unwrap_or("Unknown error");
                let _ = tx.send(Err(format!("ACP error {}: {}", code, message)));
            } else {
                let _ = tx.send(Ok(msg["result"].clone()));
            }
        }
        return;
    }

    if has_method {
        let method = msg["method"].as_str().unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or_default();
        let id = msg.get("id").and_then(|v| v.as_u64()).map(|n| n as u32);

        match method {
            "session/update" => {
                handle_session_update(&params, session_map, app_handle);
            }
            "session/request_permission" => {
                handle_permission_request(
                    id,
                    &params,
                    permission_resolvers,
                    session_map,
                    connection_id,
                    agent_id,
                    app_handle,
                ).await;
            }
            _ => {
                if !method.starts_with('_') && !method.starts_with("$/") {
                    warn!("[{}] Unknown agent method: {}", agent_id, method);
                }
            }
        }
    }
}

fn handle_session_update(
    params: &JsonValue,
    session_map: &Arc<Mutex<(HashMap<String, String>, HashMap<String, String>)>>,
    app_handle: &AppHandle,
) {
    let remote_id = params["sessionId"].as_str().unwrap_or("");
    let internal_id = {
        let map = session_map.lock().unwrap();
        map.0.get(remote_id).cloned().unwrap_or_else(|| remote_id.to_string())
    };

    let update = match params.get("update") {
        Some(u) => u,
        None => return,
    };

    let transformed = transform_session_update(update);

    let event = json!({
        "sessionId": internal_id,
        "update": transformed
    });

    let _ = app_handle.emit("session:update", event);
}

fn transform_session_update(raw: &JsonValue) -> JsonValue {
    let update_type = raw["sessionUpdate"].as_str().unwrap_or("");

    match update_type {
        "agent_message_start" => json!({
            "type": "message_start",
            "messageId": raw["messageId"].as_str().unwrap_or("current")
        }),

        "agent_message_chunk" => {
            let text = extract_text(raw);
            json!({
                "type": "text_chunk",
                "messageId": raw["messageId"].as_str().unwrap_or("current"),
                "text": text
            })
        }

        "agent_thought_chunk" => json!({
            "type": "thinking_chunk",
            "messageId": raw["messageId"].as_str().unwrap_or("current"),
            "text": extract_text(raw)
        }),

        "agent_message_complete" | "message_complete" => json!({
            "type": "message_complete",
            "messageId": raw["messageId"].as_str().unwrap_or("current"),
            "stopReason": raw["stopReason"].as_str().unwrap_or("end_turn")
        }),

        "tool_call" => {
            let tool_call_id = raw["toolCallId"].as_str()
                .unwrap_or("")
                .to_string();
            let tool_call_id = if tool_call_id.is_empty() {
                Uuid::new_v4().to_string()
            } else {
                tool_call_id
            };

            let tool_name = raw["_meta"]["claudeCode"]["toolName"]
                .as_str()
                .or_else(|| raw["title"].as_str())
                .unwrap_or("unknown");

            json!({
                "type": "tool_call_start",
                "messageId": raw["messageId"].as_str().unwrap_or("current"),
                "toolCall": {
                    "toolCallId": tool_call_id,
                    "title": raw["title"].as_str().unwrap_or("Tool Call"),
                    "name": tool_name,
                    "kind": raw["kind"],
                    "status": raw["status"].as_str().unwrap_or("pending"),
                    "input": raw["rawInput"].to_string(),
                    "rawInput": raw["rawInput"],
                    "locations": raw["locations"]
                }
            })
        }

        "tool_call_update" => {
            let tool_call_id = raw["toolCallId"].as_str()
                .or_else(|| raw["toolCall"]["toolCallId"].as_str())
                .or_else(|| raw["id"].as_str())
                .unwrap_or("");

            let output = if raw["rawOutput"].is_string() {
                raw["rawOutput"].as_str().map(|s| json!(s))
            } else if !raw["rawOutput"].is_null() {
                Some(json!(raw["rawOutput"].to_string()))
            } else {
                None
            };

            json!({
                "type": "tool_call_update",
                "toolCallId": tool_call_id,
                "status": raw["status"].as_str().unwrap_or("completed"),
                "output": output,
                "locations": raw["locations"]
            })
        }

        "plan" => {
            let entries = raw["entries"].as_array().cloned().unwrap_or_default();
            json!({
                "type": "plan_update",
                "entries": entries.iter().map(|e| json!({
                    "content": e["content"].as_str().unwrap_or(""),
                    "priority": e["priority"].as_str().unwrap_or("medium"),
                    "status": e["status"].as_str().unwrap_or("pending")
                })).collect::<Vec<_>>()
            })
        }

        "current_mode_update" => json!({
            "type": "current_mode_update",
            "modeId": raw["modeId"].as_str().unwrap_or("")
        }),

        "config_options_update" => {
            let options = raw["options"].as_array().cloned().unwrap_or_default();
            json!({
                "type": "config_options_update",
                "options": options.iter().map(|opt| json!({
                    "id": opt["id"].as_str().unwrap_or(""),
                    "name": opt["name"].as_str().unwrap_or(""),
                    "description": opt["description"],
                    "category": opt["category"],
                    "type": "select",
                    "currentValue": opt["currentValue"].as_str().unwrap_or(""),
                    "options": opt["options"].as_array().cloned().unwrap_or_default().iter().map(|v| json!({
                        "value": v["value"].as_str().unwrap_or(""),
                        "name": v["name"].as_str().unwrap_or(""),
                        "description": v["description"]
                    })).collect::<Vec<_>>()
                })).collect::<Vec<_>>()
            })
        }

        "available_commands_update" => {
            let commands = raw["availableCommands"].as_array()
                .or_else(|| raw["commands"].as_array())
                .cloned()
                .unwrap_or_default();
            json!({
                "type": "available_commands_update",
                "commands": commands.iter().map(|cmd| json!({
                    "name": cmd["name"].as_str().unwrap_or(""),
                    "description": cmd["description"].as_str().unwrap_or(""),
                    "input": cmd["input"]
                })).collect::<Vec<_>>()
            })
        }

        "session_info_update" => json!({
            "type": "session_info_update",
            "title": raw["title"],
            "updatedAt": raw["updatedAt"],
            "_meta": raw["_meta"]
        }),

        "usage_update" => json!({
            "type": "usage_update",
            "usage": {
                "used": raw["used"].as_u64().unwrap_or(0),
                "size": raw["size"].as_u64().unwrap_or(0),
                "cost": raw["cost"]
            }
        }),

        _ => json!({ "type": "text_chunk", "messageId": "current", "text": "" }),
    }
}

fn extract_text(raw: &JsonValue) -> String {
    if let Some(content) = raw.get("content") {
        if let Some(s) = content.as_str() { return s.to_string(); }
        if let Some(obj) = content.as_object() {
            if let Some(t) = obj.get("text").and_then(|v| v.as_str()) { return t.to_string(); }
            if let Some(t) = obj.get("data").and_then(|v| v.as_str()) { return t.to_string(); }
        }
    }
    if let Some(t) = raw["text"].as_str() { return t.to_string(); }
    if let Some(t) = raw["data"].as_str() { return t.to_string(); }
    String::new()
}

async fn handle_permission_request(
    id: Option<u32>,
    params: &JsonValue,
    permission_resolvers: &Arc<Mutex<HashMap<String, PermissionResolver>>>,
    session_map: &Arc<Mutex<(HashMap<String, String>, HashMap<String, String>)>>,
    connection_id: &str,
    agent_id: &str,
    app_handle: &AppHandle,
) {
    let request_id = Uuid::new_v4().to_string();

    let remote_session_id = params["sessionId"].as_str()
        .or_else(|| params["_meta"]["sessionId"].as_str())
        .unwrap_or("");

    let internal_session_id = {
        let map = session_map.lock().unwrap();
        map.0.get(remote_session_id).cloned()
            .unwrap_or_else(|| remote_session_id.to_string())
    };

    let tool_call = &params["toolCall"];
    let options_raw = params["options"].as_array().cloned().unwrap_or_default();
    let options = if options_raw.is_empty() {
        vec![
            json!({ "optionId": "deny", "name": "Deny", "kind": "reject_once" }),
            json!({ "optionId": "allow", "name": "Allow", "kind": "allow_once" }),
        ]
    } else {
        options_raw.iter().map(|opt| json!({
            "optionId": opt["optionId"].as_str().unwrap_or(""),
            "name": opt["name"].as_str().unwrap_or(""),
            "kind": opt["kind"].as_str().unwrap_or("allow_once")
        })).collect()
    };

    let event = json!({
        "sessionId": internal_session_id,
        "requestId": request_id,
        "toolCall": {
            "toolCallId": tool_call["toolCallId"].as_str().unwrap_or(""),
            "title": tool_call["title"],
            "kind": tool_call["kind"],
            "rawInput": tool_call["rawInput"]
        },
        "options": options
    });

    // Set up resolver
    let (tx, rx) = oneshot::channel::<JsonValue>();
    {
        let mut resolvers = permission_resolvers.lock().unwrap();
        resolvers.insert(request_id.clone(), tx);
    }

    // Emit permission request to renderer
    let _ = app_handle.emit("session:permission-request", event);

    // Clone what we need for the async task
    let app_handle_clone = app_handle.clone();
    let agent_id_clone = agent_id.to_string();
    let permission_resolvers_clone = Arc::clone(permission_resolvers);

    // Wait for response in background task
    tokio::spawn(async move {
        let response = tokio::time::timeout(
            Duration::from_secs(300), // 5 minute timeout
            rx
        ).await;

        let option_id = match response {
            Ok(Ok(resp)) => resp["optionId"].as_str().unwrap_or("__cancelled__").to_string(),
            _ => {
                warn!("[{}] Permission request {} timed out", agent_id_clone, request_id);
                permission_resolvers_clone.lock().unwrap().remove(&request_id);
                "__cancelled__".to_string()
            }
        };

        // Emit resolved event
        let _ = app_handle_clone.emit("session:permission-resolved", json!({
            "requestId": request_id
        }));

        // Note: In the Tauri version we need a way to send the response back to the agent.
        // This is done via a channel that the caller (session_manager) monitors.
        // The actual RPC response sending needs to be handled through a different mechanism.
        // For now, log the resolution.
        info!("[{}] Permission resolved: {}", agent_id_clone, option_id);
    });
}

fn emit_session_new_updates(
    session_id: &str,
    result: &JsonValue,
    preferred_mode_id: Option<&str>,
    app_handle: &AppHandle,
) {
    // Emit modes
    if let Some(modes) = result["modes"].as_object() {
        if let Some(available) = modes.get("availableModes").and_then(|v| v.as_array()) {
            if !available.is_empty() {
                let current_mode = preferred_mode_id
                    .and_then(|p| if available.iter().any(|m| m["id"].as_str() == Some(p)) { Some(p) } else { None })
                    .or_else(|| modes.get("currentModeId").and_then(|v| v.as_str()))
                    .unwrap_or_else(|| available[0]["id"].as_str().unwrap_or(""));

                let mode_option = json!({
                    "id": "_mode",
                    "name": "Mode",
                    "category": "mode",
                    "type": "select",
                    "currentValue": current_mode,
                    "options": available.iter().map(|m| json!({
                        "value": m["id"].as_str().unwrap_or(""),
                        "name": m["name"].as_str().unwrap_or(""),
                        "description": m["description"]
                    })).collect::<Vec<_>>()
                });

                let _ = app_handle.emit("session:update", json!({
                    "sessionId": session_id,
                    "update": { "type": "config_options_update", "options": [mode_option] }
                }));

                if !current_mode.is_empty() {
                    let _ = app_handle.emit("session:update", json!({
                        "sessionId": session_id,
                        "update": { "type": "current_mode_update", "modeId": current_mode }
                    }));
                }
            }
        }
    }

    // Emit config options
    if let Some(config_options) = result["configOptions"].as_array() {
        if !config_options.is_empty() {
            let options: Vec<JsonValue> = config_options.iter().map(|opt| json!({
                "id": opt["id"].as_str().unwrap_or(""),
                "name": opt["name"].as_str().unwrap_or(""),
                "description": opt["description"],
                "category": opt["category"],
                "type": "select",
                "currentValue": opt["currentValue"].as_str().unwrap_or(""),
                "options": opt["options"].as_array().cloned().unwrap_or_default().iter().map(|v| json!({
                    "value": v["value"].as_str().unwrap_or(""),
                    "name": v["name"].as_str().unwrap_or(""),
                    "description": v["description"]
                })).collect::<Vec<_>>()
            })).collect();

            let _ = app_handle.emit("session:update", json!({
                "sessionId": session_id,
                "update": { "type": "config_options_update", "options": options }
            }));
        }
    }
}
