use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Agent not found: {0}")]
    AgentNotFound(String),
    #[error("Connection not found: {0}")]
    ConnectionNotFound(String),
    #[error("Session not found: {0}")]
    SessionNotFound(String),
    #[error("Workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Git error: {0}")]
    Git(String),
    #[error("Process error: {0}")]
    Process(String),
    #[error("Timeout: {0}")]
    Timeout(String),
    #[error("ACP error: {0}")]
    Acp(String),
    #[error("{0}")]
    Other(String),
}

// Tauri commands must return a serializable error type
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Other(e.to_string())
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Other(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Other(s.to_string())
    }
}
