use std::fs;
use std::path::Path;
use tauri::{AppHandle, State};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use crate::state::AppState;
use crate::error::{AppError, Result};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileTreeNode>>,
}

#[tauri::command]
pub async fn file_read_tree(
    dir_path: String,
    depth: Option<u32>,
) -> Result<Vec<FileTreeNode>> {
    let max_depth = depth.unwrap_or(3);
    read_tree(&dir_path, max_depth, 0).map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn file_read(file_path: String) -> Result<String> {
    fs::read_to_string(&file_path)
        .map_err(|e| AppError::Io(e))
}

#[tauri::command]
pub async fn file_get_changes(working_dir: String) -> Result<JsonValue> {
    // Get file changes from git status
    let output = std::process::Command::new("git")
        .args(["-C", &working_dir, "status", "--porcelain=v1", "-u"])
        .output()
        .map_err(|e| AppError::Io(e))?;

    let text = String::from_utf8_lossy(&output.stdout);
    let changes: Vec<JsonValue> = text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let status = &line[..2];
            let path = line[3..].to_string();
            json!({
                "path": path,
                "status": parse_git_status(status)
            })
        })
        .collect();

    Ok(json!(changes))
}

#[tauri::command]
pub async fn project_open(path: String) -> Result<JsonValue> {
    let exists = Path::new(&path).exists();
    if !exists {
        return Err(AppError::Other(format!("Path does not exist: {}", path)));
    }

    let is_git = std::process::Command::new("git")
        .args(["-C", &path, "rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let branch = if is_git {
        std::process::Command::new("git")
            .args(["-C", &path, "branch", "--show-current"])
            .output()
            .ok()
            .and_then(|o| if o.status.success() {
                String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string())
            } else {
                None
            })
    } else {
        None
    };

    Ok(json!({
        "path": path,
        "name": Path::new(&path).file_name().and_then(|n| n.to_str()).unwrap_or(""),
        "isGitRepo": is_git,
        "currentBranch": branch
    }))
}

#[tauri::command]
pub async fn project_select_directory(app: AppHandle) -> Result<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let dir = app.dialog()
        .file()
        .pick_folder()
        .await;

    Ok(dir.and_then(|p| p.to_str().map(|s| s.to_string())))
}

// ============================
// Private helpers
// ============================

fn read_tree(dir: &str, max_depth: u32, current_depth: u32) -> std::result::Result<Vec<FileTreeNode>, std::io::Error> {
    if current_depth >= max_depth {
        return Ok(vec![]);
    }

    let mut nodes = vec![];

    let entries = fs::read_dir(dir)?;
    let mut sorted_entries: Vec<_> = entries
        .filter_map(|e| e.ok())
        .collect();

    sorted_entries.sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });

    for entry in sorted_entries {
        let path = entry.path();
        let name = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // Skip hidden files and common ignored dirs
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }

        let is_dir = path.is_dir();
        let children = if is_dir && current_depth + 1 < max_depth {
            Some(read_tree(&path.to_string_lossy(), max_depth, current_depth + 1)?)
        } else {
            None
        };

        nodes.push(FileTreeNode {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }

    Ok(nodes)
}

fn parse_git_status(xy: &str) -> &str {
    match xy.trim() {
        "M" | "MM" | " M" => "modified",
        "A" | "AM" => "added",
        "D" | " D" => "deleted",
        "R" | "RM" => "renamed",
        "??" => "untracked",
        _ => "unknown",
    }
}
