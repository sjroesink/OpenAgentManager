use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};
use log::{info, warn};

const DEFAULT_WORKTREE_PREFIX: &str = "am-";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub is_clean: bool,
    pub staged: Vec<String>,
    pub modified: Vec<String>,
    pub untracked: Vec<String>,
    pub ahead: i32,
    pub behind: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub head: String,
    pub is_main: bool,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub hash: String,
    pub message: String,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub files: Vec<FileDiff>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old_content: String,
    pub new_content: String,
}

pub struct GitService {
    worktrees_dir: PathBuf,
}

impl GitService {
    pub fn new(data_dir: &PathBuf) -> Self {
        Self {
            worktrees_dir: data_dir.join("worktrees"),
        }
    }

    pub fn create_worktree(
        &self,
        project_path: &str,
        session_id: &str,
        base_branch: Option<&str>,
        custom_branch: Option<&str>,
        worktree_base_dir: Option<&str>,
    ) -> Result<WorktreeInfo, String> {
        // Verify git repo
        if !self.is_git_repo(project_path) {
            return Err(format!("Not a git repository: {}", project_path));
        }

        let branch_name = custom_branch
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("{}{}", DEFAULT_WORKTREE_PREFIX, session_id));

        let worktree_base = worktree_base_dir
            .map(|d| PathBuf::from(d))
            .unwrap_or_else(|| {
                let project_name = Path::new(project_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("project");
                self.worktrees_dir.join(project_name)
            });

        let worktree_path = worktree_base.join(format!("thread-{}", session_id));

        fs::create_dir_all(&worktree_base).map_err(|e| e.to_string())?;

        let base = base_branch.unwrap_or("HEAD");

        let output = Command::new("git")
            .args(["-C", project_path, "worktree", "add", "-b", &branch_name,
                   &worktree_path.to_string_lossy(), base])
            .output()
            .map_err(|e| format!("git worktree add failed: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        let head = self.get_head(&worktree_path.to_string_lossy());

        info!("Worktree created: {} on branch {}", worktree_path.display(), branch_name);

        Ok(WorktreeInfo {
            path: worktree_path.to_string_lossy().to_string(),
            branch: branch_name,
            head,
            is_main: false,
            created_at: chrono::Utc::now().to_rfc3339(),
            session_id: Some(session_id.to_string()),
        })
    }

    pub fn remove_worktree(&self, project_path: &str, worktree_path: &str) -> Result<(), String> {
        let output = Command::new("git")
            .args(["-C", project_path, "worktree", "remove", worktree_path, "--force"])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            warn!("git worktree remove failed, trying manual cleanup");
            if Path::new(worktree_path).exists() {
                fs::remove_dir_all(worktree_path).map_err(|e| e.to_string())?;
            }
            Command::new("git")
                .args(["-C", project_path, "worktree", "prune"])
                .output()
                .ok();
        }

        info!("Worktree removed: {}", worktree_path);
        Ok(())
    }

    pub fn list_worktrees(&self, project_path: &str) -> Result<Vec<WorktreeInfo>, String> {
        let output = Command::new("git")
            .args(["-C", project_path, "worktree", "list", "--porcelain"])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        let porcelain = String::from_utf8_lossy(&output.stdout);
        Ok(self.parse_worktree_list(&porcelain))
    }

    pub fn get_status(&self, working_dir: &str) -> Result<GitStatus, String> {
        // Get branch
        let branch = self.get_current_branch(working_dir).unwrap_or_default();

        // Get status
        let output = Command::new("git")
            .args(["-C", working_dir, "status", "--porcelain=v1", "-u"])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        let status_text = String::from_utf8_lossy(&output.stdout);
        let mut staged = vec![];
        let mut modified = vec![];
        let mut untracked = vec![];

        for line in status_text.lines() {
            if line.len() < 3 { continue; }
            let xy = &line[..2];
            let path = line[3..].to_string();

            let x = xy.chars().next().unwrap_or(' ');
            let y = xy.chars().nth(1).unwrap_or(' ');

            if x != ' ' && x != '?' { staged.push(path.clone()); }
            if y != ' ' && y != '?' { modified.push(path.clone()); }
            if xy == "??" { untracked.push(path); }
        }

        let is_clean = staged.is_empty() && modified.is_empty() && untracked.is_empty();

        // Get ahead/behind
        let (ahead, behind) = self.get_ahead_behind(working_dir);

        Ok(GitStatus {
            branch,
            is_clean,
            staged,
            modified,
            untracked,
            ahead,
            behind,
        })
    }

    pub fn commit(
        &self,
        working_dir: &str,
        message: &str,
        files: &[String],
    ) -> Result<CommitResult, String> {
        // Stage files
        let mut add_args = vec!["-C", working_dir, "add"];
        let files_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
        add_args.extend(files_refs);

        let output = Command::new("git")
            .args(&add_args)
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        // Commit
        let output = Command::new("git")
            .args(["-C", working_dir, "commit", "-m", message])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        let hash = self.get_head(working_dir);
        let branch = self.get_current_branch(working_dir).unwrap_or_default();

        Ok(CommitResult {
            hash,
            message: message.to_string(),
            branch,
        })
    }

    pub fn get_diff(&self, working_dir: &str, file_path: Option<&str>) -> Result<DiffResult, String> {
        let mut args = vec!["-C", working_dir, "diff", "HEAD"];
        if let Some(fp) = file_path {
            args.push("--");
            args.push(fp);
        }

        let output = Command::new("git")
            .args(&args)
            .output()
            .map_err(|e| e.to_string())?;

        let diff_text = if output.status.success() {
            String::from_utf8_lossy(&output.stdout).to_string()
        } else {
            // Try cached diff if HEAD doesn't exist
            let output2 = Command::new("git")
                .args(["-C", working_dir, "diff", "--cached"])
                .output()
                .map_err(|e| e.to_string())?;
            String::from_utf8_lossy(&output2.stdout).to_string()
        };

        self.parse_diff(&diff_text, working_dir)
    }

    pub fn rename_branch(&self, worktree_path: &str, new_branch: &str) -> Result<String, String> {
        let old_branch = self.get_current_branch(worktree_path)
            .ok_or("Could not get current branch")?;

        let output = Command::new("git")
            .args(["-C", worktree_path, "branch", "-m", &old_branch, new_branch])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        info!("Branch renamed: {} → {} in {}", old_branch, new_branch, worktree_path);
        Ok(new_branch.to_string())
    }

    pub fn is_git_repo(&self, path: &str) -> bool {
        Command::new("git")
            .args(["-C", path, "rev-parse", "--is-inside-work-tree"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    pub fn get_current_branch(&self, path: &str) -> Option<String> {
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

    // ============================
    // Private helpers
    // ============================

    fn get_head(&self, path: &str) -> String {
        Command::new("git")
            .args(["-C", path, "rev-parse", "HEAD"])
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string())
                } else {
                    None
                }
            })
            .unwrap_or_default()
    }

    fn get_ahead_behind(&self, path: &str) -> (i32, i32) {
        let output = Command::new("git")
            .args(["-C", path, "rev-list", "--count", "--left-right", "@{u}...HEAD"])
            .output();

        match output {
            Ok(o) if o.status.success() => {
                let s = String::from_utf8_lossy(&o.stdout);
                let parts: Vec<&str> = s.trim().split('\t').collect();
                if parts.len() == 2 {
                    let behind = parts[0].parse().unwrap_or(0);
                    let ahead = parts[1].parse().unwrap_or(0);
                    return (ahead, behind);
                }
                (0, 0)
            }
            _ => (0, 0),
        }
    }

    fn parse_worktree_list(&self, porcelain: &str) -> Vec<WorktreeInfo> {
        let mut worktrees = vec![];
        let blocks = porcelain.trim().split("\n\n");

        for block in blocks {
            if block.trim().is_empty() { continue; }

            let mut wt_path = String::new();
            let mut head = String::new();
            let mut branch = String::new();

            for line in block.lines() {
                if let Some(p) = line.strip_prefix("worktree ") {
                    wt_path = p.to_string();
                } else if let Some(h) = line.strip_prefix("HEAD ") {
                    head = h.to_string();
                } else if let Some(b) = line.strip_prefix("branch ") {
                    branch = b.replace("refs/heads/", "");
                }
            }

            if !wt_path.is_empty() {
                let is_main = worktrees.is_empty();
                worktrees.push(WorktreeInfo {
                    path: wt_path,
                    branch,
                    head,
                    is_main,
                    created_at: String::new(),
                    session_id: None,
                });
            }
        }

        worktrees
    }

    fn parse_diff(&self, diff_text: &str, working_dir: &str) -> Result<DiffResult, String> {
        let mut files = vec![];

        if diff_text.trim().is_empty() {
            return Ok(DiffResult { files });
        }

        let sections: Vec<&str> = diff_text.split("diff --git ").filter(|s| !s.is_empty()).collect();

        for section in sections {
            let lines: Vec<&str> = section.lines().collect();
            if lines.is_empty() { continue; }

            let header = lines[0];
            if let Some(caps) = parse_diff_header(header) {
                let file_path = caps;

                let full_path = Path::new(working_dir).join(&file_path);
                let new_content = if full_path.exists() {
                    fs::read_to_string(&full_path).unwrap_or_default()
                } else {
                    String::new()
                };

                let old_content = Command::new("git")
                    .args(["-C", working_dir, "show", &format!("HEAD:{}", file_path)])
                    .output()
                    .ok()
                    .and_then(|o| if o.status.success() {
                        String::from_utf8(o.stdout).ok()
                    } else {
                        None
                    })
                    .unwrap_or_default();

                files.push(FileDiff {
                    path: file_path,
                    old_content,
                    new_content,
                });
            }
        }

        Ok(DiffResult { files })
    }
}

fn parse_diff_header(header: &str) -> Option<String> {
    // "a/path/to/file b/path/to/file"
    let re = header.trim();
    let parts: Vec<&str> = re.splitn(2, " b/").collect();
    if parts.len() == 2 {
        Some(parts[1].to_string())
    } else {
        None
    }
}
