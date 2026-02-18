use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use log::{error, info, warn};
use chrono::Utc;

// ============================================================
// Thread Store - ATSF v1.1 format persistence
// Stores threads in .agent/threads/{threadId}/thread.json + messages.jsonl
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedThread {
    pub session_id: String,
    pub title: String,
    pub agent_id: String,
    pub agent_name: String,
    pub working_dir: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_worktree: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interaction_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    pub messages: Vec<serde_json::Value>,
}

pub struct ThreadStore {
    data_dir: PathBuf,
    cache_path: PathBuf,
}

impl ThreadStore {
    pub fn new(data_dir: &PathBuf) -> Self {
        Self {
            data_dir: data_dir.clone(),
            cache_path: data_dir.join("thread-cache.json"),
        }
    }

    /// Save a thread (both to workspace .agent/ folder and cache)
    pub fn save(&self, session: &serde_json::Value) -> Result<(), String> {
        let session_id = session["sessionId"].as_str()
            .ok_or("Missing sessionId")?;
        let working_dir = session["workingDir"].as_str()
            .ok_or("Missing workingDir")?;

        let thread_dir = self.get_thread_dir(working_dir, session_id);
        fs::create_dir_all(&thread_dir).map_err(|e| e.to_string())?;

        // Write thread manifest
        let now = Utc::now().to_rfc3339();
        let manifest = serde_json::json!({
            "sessionId": session_id,
            "title": session["title"].as_str().unwrap_or("Untitled"),
            "agentId": session["agentId"].as_str().unwrap_or(""),
            "agentName": session["agentName"].as_str().unwrap_or(""),
            "workingDir": working_dir,
            "createdAt": session["createdAt"].as_str().unwrap_or(&now),
            "updatedAt": now,
            "workspaceId": session["workspaceId"],
            "worktreePath": session["worktreePath"],
            "worktreeBranch": session["worktreeBranch"],
            "useWorktree": session["useWorktree"],
            "interactionMode": session["interactionMode"],
            "parentSessionId": session["parentSessionId"],
        });

        let manifest_path = thread_dir.join("thread.json");
        fs::write(&manifest_path, serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;

        // Write messages to JSONL
        let messages = session["messages"].as_array().cloned().unwrap_or_default();
        let messages_path = thread_dir.join("messages.jsonl");
        let mut file = fs::File::create(&messages_path).map_err(|e| e.to_string())?;
        for msg in &messages {
            let line = serde_json::to_string(msg).map_err(|e| e.to_string())?;
            writeln!(file, "{}", line).map_err(|e| e.to_string())?;
        }

        // Update cache
        self.update_cache(session_id, &manifest, messages.len());

        Ok(())
    }

    /// Update only the messages for a thread
    pub fn update_messages(&self, session_id: &str, working_dir: &str, messages: &serde_json::Value) -> Result<(), String> {
        let thread_dir = self.get_thread_dir(working_dir, session_id);
        if !thread_dir.exists() {
            return Ok(()); // Thread not persisted yet
        }

        // Update messages.jsonl
        let messages_path = thread_dir.join("messages.jsonl");
        let msgs = messages.as_array().cloned().unwrap_or_default();
        let mut file = fs::File::create(&messages_path).map_err(|e| e.to_string())?;
        for msg in &msgs {
            let line = serde_json::to_string(msg).map_err(|e| e.to_string())?;
            writeln!(file, "{}", line).map_err(|e| e.to_string())?;
        }

        // Update manifest updatedAt
        let manifest_path = thread_dir.join("thread.json");
        if manifest_path.exists() {
            if let Ok(content) = fs::read_to_string(&manifest_path) {
                if let Ok(mut manifest) = serde_json::from_str::<serde_json::Value>(&content) {
                    manifest["updatedAt"] = serde_json::Value::String(Utc::now().to_rfc3339());
                    let _ = fs::write(&manifest_path, serde_json::to_string_pretty(&manifest).unwrap_or_default());
                }
            }
        }

        Ok(())
    }

    /// Rename a thread
    pub fn rename(&self, session_id: &str, working_dir: &str, title: &str) -> Result<(), String> {
        let thread_dir = self.get_thread_dir(working_dir, session_id);
        let manifest_path = thread_dir.join("thread.json");

        if manifest_path.exists() {
            if let Ok(content) = fs::read_to_string(&manifest_path) {
                if let Ok(mut manifest) = serde_json::from_str::<serde_json::Value>(&content) {
                    manifest["title"] = serde_json::Value::String(title.to_string());
                    manifest["updatedAt"] = serde_json::Value::String(Utc::now().to_rfc3339());
                    fs::write(&manifest_path, serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?;
                }
            }
        }

        // Update cache
        let mut cache = self.load_cache();
        if let Some(entry) = cache.get_mut(session_id) {
            entry["title"] = serde_json::Value::String(title.to_string());
        }
        self.save_cache(&cache);

        Ok(())
    }

    /// Remove a thread
    pub fn remove(&self, session_id: &str, working_dir: &str) -> Result<(), String> {
        let thread_dir = self.get_thread_dir(working_dir, session_id);
        if thread_dir.exists() {
            fs::remove_dir_all(&thread_dir).map_err(|e| e.to_string())?;
        }

        // Remove from cache
        let mut cache = self.load_cache();
        cache.remove(session_id);
        self.save_cache(&cache);

        Ok(())
    }

    /// Load all persisted threads from cache + scan workspaces
    pub fn load_all(&self) -> Vec<PersistedThread> {
        let cache = self.load_cache();
        let mut threads = Vec::new();

        for (session_id, entry) in &cache {
            let working_dir = match entry["workingDir"].as_str() {
                Some(d) => d.to_string(),
                None => continue,
            };

            // Load full thread from disk
            if let Some(thread) = self.load_thread(session_id, &working_dir) {
                threads.push(thread);
            }
        }

        // Sort by updatedAt descending
        threads.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        threads
    }

    /// Rebuild cache by scanning workspace directories
    pub fn rebuild_cache(&self, workspace_paths: &[(String, String)]) {
        let mut cache = HashMap::new();

        for (workspace_id, workspace_path) in workspace_paths {
            let agent_dir = Path::new(workspace_path).join(".agent").join("threads");
            if !agent_dir.exists() {
                continue;
            }

            if let Ok(entries) = fs::read_dir(&agent_dir) {
                for entry in entries.flatten() {
                    let thread_dir = entry.path();
                    let manifest_path = thread_dir.join("thread.json");
                    if !manifest_path.exists() {
                        continue;
                    }

                    if let Ok(content) = fs::read_to_string(&manifest_path) {
                        if let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&content) {
                            let session_id = manifest["sessionId"].as_str()
                                .unwrap_or("")
                                .to_string();
                            if !session_id.is_empty() {
                                let mut entry = manifest.clone();
                                entry["workspaceId"] = serde_json::Value::String(workspace_id.clone());
                                cache.insert(session_id, entry);
                            }
                        }
                    }
                }
            }

            // Also scan worktree subdirectories
            let worktrees_scan_path = Path::new(workspace_path).join(".agent");
            let _ = self.scan_worktrees_for_threads(workspace_id, &worktrees_scan_path, &mut cache);
        }

        self.save_cache(&cache);
        info!("Rebuilt thread cache: {} threads", cache.len());
    }

    pub fn update_interaction_mode(&self, session_id: &str, working_dir: &str, mode: &str) -> Result<(), String> {
        let thread_dir = self.get_thread_dir(working_dir, session_id);
        let manifest_path = thread_dir.join("thread.json");

        if manifest_path.exists() {
            if let Ok(content) = fs::read_to_string(&manifest_path) {
                if let Ok(mut manifest) = serde_json::from_str::<serde_json::Value>(&content) {
                    manifest["interactionMode"] = serde_json::Value::String(mode.to_string());
                    let _ = fs::write(&manifest_path, serde_json::to_string_pretty(&manifest).unwrap_or_default());
                }
            }
        }
        Ok(())
    }

    // ============================
    // Private helpers
    // ============================

    fn get_thread_dir(&self, working_dir: &str, session_id: &str) -> PathBuf {
        Path::new(working_dir)
            .join(".agent")
            .join("threads")
            .join(session_id)
    }

    fn load_thread(&self, session_id: &str, working_dir: &str) -> Option<PersistedThread> {
        let thread_dir = self.get_thread_dir(working_dir, session_id);
        let manifest_path = thread_dir.join("thread.json");
        let messages_path = thread_dir.join("messages.jsonl");

        if !manifest_path.exists() {
            return None;
        }

        let content = fs::read_to_string(&manifest_path).ok()?;
        let manifest: serde_json::Value = serde_json::from_str(&content).ok()?;

        // Load messages from JSONL
        let messages = if messages_path.exists() {
            let file = fs::File::open(&messages_path).ok()?;
            let reader = BufReader::new(file);
            reader.lines()
                .filter_map(|l| l.ok())
                .filter(|l| !l.trim().is_empty())
                .filter_map(|l| serde_json::from_str::<serde_json::Value>(&l).ok())
                .collect()
        } else {
            vec![]
        };

        Some(PersistedThread {
            session_id: manifest["sessionId"].as_str().unwrap_or(session_id).to_string(),
            title: manifest["title"].as_str().unwrap_or("Untitled").to_string(),
            agent_id: manifest["agentId"].as_str().unwrap_or("").to_string(),
            agent_name: manifest["agentName"].as_str().unwrap_or("").to_string(),
            working_dir: manifest["workingDir"].as_str().unwrap_or(working_dir).to_string(),
            created_at: manifest["createdAt"].as_str().unwrap_or("").to_string(),
            updated_at: manifest["updatedAt"].as_str().unwrap_or("").to_string(),
            workspace_id: manifest["workspaceId"].as_str().map(|s| s.to_string()),
            worktree_path: manifest["worktreePath"].as_str().map(|s| s.to_string()),
            worktree_branch: manifest["worktreeBranch"].as_str().map(|s| s.to_string()),
            use_worktree: manifest["useWorktree"].as_bool(),
            interaction_mode: manifest["interactionMode"].as_str().map(|s| s.to_string()),
            parent_session_id: manifest["parentSessionId"].as_str().map(|s| s.to_string()),
            messages,
        })
    }

    fn load_cache(&self) -> HashMap<String, serde_json::Value> {
        if !self.cache_path.exists() {
            return HashMap::new();
        }
        match fs::read_to_string(&self.cache_path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => HashMap::new(),
        }
    }

    fn save_cache(&self, cache: &HashMap<String, serde_json::Value>) {
        if let Some(parent) = self.cache_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(cache) {
            let _ = fs::write(&self.cache_path, json);
        }
    }

    fn update_cache(&self, session_id: &str, manifest: &serde_json::Value, _message_count: usize) {
        let mut cache = self.load_cache();
        cache.insert(session_id.to_string(), manifest.clone());
        self.save_cache(&cache);
    }

    fn scan_worktrees_for_threads(
        &self,
        workspace_id: &str,
        base_dir: &Path,
        cache: &mut HashMap<String, serde_json::Value>,
    ) -> Result<(), String> {
        // Scan for .agent/threads/ in adjacent directories (worktrees)
        if let Ok(entries) = fs::read_dir(base_dir.parent().unwrap_or(base_dir)) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() { continue; }
                let agent_dir = path.join(".agent").join("threads");
                if !agent_dir.exists() { continue; }

                if let Ok(thread_entries) = fs::read_dir(&agent_dir) {
                    for thread_entry in thread_entries.flatten() {
                        let manifest_path = thread_entry.path().join("thread.json");
                        if !manifest_path.exists() { continue; }

                        if let Ok(content) = fs::read_to_string(&manifest_path) {
                            if let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&content) {
                                let session_id = manifest["sessionId"].as_str()
                                    .unwrap_or("")
                                    .to_string();
                                if !session_id.is_empty() && !cache.contains_key(&session_id) {
                                    let mut entry = manifest.clone();
                                    entry["workspaceId"] = serde_json::Value::String(workspace_id.to_string());
                                    cache.insert(session_id, entry);
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }
}
