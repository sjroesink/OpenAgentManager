use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use log::warn;
use chrono::Utc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub last_accessed_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_interaction_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_use_worktree: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_git_repo: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_branch: Option<String>,
}

pub struct WorkspaceService {
    workspaces_path: PathBuf,
}

impl WorkspaceService {
    pub fn new(data_dir: &PathBuf) -> Self {
        Self {
            workspaces_path: data_dir.join("workspaces.json"),
        }
    }

    pub fn list(&self) -> Vec<WorkspaceInfo> {
        self.load_workspaces()
    }

    pub fn get(&self, id: &str) -> Option<WorkspaceInfo> {
        self.load_workspaces().into_iter().find(|w| w.id == id)
    }

    pub fn create(&self, path: &str, name: Option<&str>) -> Result<WorkspaceInfo, String> {
        let mut workspaces = self.load_workspaces();

        // Resolve name from path if not provided
        let workspace_name = name
            .map(|n| n.to_string())
            .unwrap_or_else(|| {
                Path::new(path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Workspace")
                    .to_string()
            });

        // Check if workspace with same path already exists
        if let Some(existing) = workspaces.iter().find(|w| w.path == path) {
            return Ok(existing.clone());
        }

        let now = Utc::now().to_rfc3339();
        let is_git = is_git_repo(path);
        let branch = if is_git { get_git_branch(path) } else { None };

        let workspace = WorkspaceInfo {
            id: Uuid::new_v4().to_string(),
            name: workspace_name,
            path: path.to_string(),
            created_at: now.clone(),
            last_accessed_at: now,
            default_agent_id: None,
            default_model_id: None,
            default_interaction_mode: None,
            default_use_worktree: None,
            is_git_repo: Some(is_git),
            current_branch: branch,
        };

        workspaces.push(workspace.clone());
        self.save_workspaces(&workspaces)?;
        Ok(workspace)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut workspaces = self.load_workspaces();
        workspaces.retain(|w| w.id != id);
        self.save_workspaces(&workspaces)
    }

    pub fn update(&self, id: &str, updates: serde_json::Value) -> Result<WorkspaceInfo, String> {
        let mut workspaces = self.load_workspaces();
        let workspace = workspaces.iter_mut().find(|w| w.id == id)
            .ok_or_else(|| format!("Workspace not found: {}", id))?;

        if let Some(obj) = updates.as_object() {
            if let Some(v) = obj.get("name") {
                if let Some(s) = v.as_str() { workspace.name = s.to_string(); }
            }
            if let Some(v) = obj.get("lastAccessedAt") {
                if let Some(s) = v.as_str() { workspace.last_accessed_at = s.to_string(); }
            }
            if let Some(v) = obj.get("defaultAgentId") {
                workspace.default_agent_id = v.as_str().map(|s| s.to_string());
            }
            if let Some(v) = obj.get("defaultModelId") {
                workspace.default_model_id = v.as_str().map(|s| s.to_string());
            }
            if let Some(v) = obj.get("defaultInteractionMode") {
                workspace.default_interaction_mode = v.as_str().map(|s| s.to_string());
            }
            if let Some(v) = obj.get("defaultUseWorktree") {
                workspace.default_use_worktree = v.as_bool();
            }
        }

        let result = workspace.clone();
        self.save_workspaces(&workspaces)?;
        Ok(result)
    }

    // ============================
    // Private helpers
    // ============================

    fn load_workspaces(&self) -> Vec<WorkspaceInfo> {
        if !self.workspaces_path.exists() {
            return vec![];
        }
        match fs::read_to_string(&self.workspaces_path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(e) => {
                warn!("Failed to read workspaces: {}", e);
                vec![]
            }
        }
    }

    fn save_workspaces(&self, workspaces: &[WorkspaceInfo]) -> Result<(), String> {
        if let Some(parent) = self.workspaces_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(workspaces)
            .map_err(|e| e.to_string())?;
        fs::write(&self.workspaces_path, json)
            .map_err(|e| e.to_string())
    }
}

fn is_git_repo(path: &str) -> bool {
    Command::new("git")
        .args(["-C", path, "rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn get_git_branch(path: &str) -> Option<String> {
    Command::new("git")
        .args(["-C", path, "branch", "--show-current"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string())
            } else {
                None
            }
        })
        .filter(|s| !s.is_empty())
}
