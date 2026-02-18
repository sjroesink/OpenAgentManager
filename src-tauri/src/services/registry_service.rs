use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use log::{info, warn};
use chrono::{DateTime, Utc, Duration};

const REGISTRY_URL: &str = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const CDN_URL: &str = "https://cdn.agentclientprotocol.com";
const CACHE_TTL_SECS: i64 = 3600; // 1 hour

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpRegistry {
    pub version: String,
    pub agents: Vec<AcpRegistryAgent>,
    #[serde(default)]
    pub extensions: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpRegistryAgent {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    pub authors: Vec<String>,
    pub license: String,
    pub icon: String,
    pub distribution: AgentDistribution,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentDistribution {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub npx: Option<NpxDistribution>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uvx: Option<UvxDistribution>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpxDistribution {
    pub package: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UvxDistribution {
    pub package: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<std::collections::HashMap<String, String>>,
}

struct CachedRegistry {
    registry: AcpRegistry,
    fetched_at: DateTime<Utc>,
}

pub struct RegistryService {
    cache_path: PathBuf,
    cached: std::sync::Mutex<Option<CachedRegistry>>,
}

impl RegistryService {
    pub fn new(data_dir: &PathBuf) -> Self {
        Self {
            cache_path: data_dir.join("cache").join("registry.json"),
            cached: std::sync::Mutex::new(None),
        }
    }

    pub async fn fetch(&self) -> Result<AcpRegistry, String> {
        // Check in-memory cache first
        {
            let cached = self.cached.lock().unwrap();
            if let Some(c) = &*cached {
                if Utc::now() - c.fetched_at < Duration::seconds(CACHE_TTL_SECS) {
                    return Ok(c.registry.clone());
                }
            }
        }

        info!("Fetching ACP registry from {}", REGISTRY_URL);

        let client = reqwest::Client::new();
        let registry: AcpRegistry = client
            .get(REGISTRY_URL)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch registry: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse registry: {}", e))?;

        // Save to disk cache
        if let Some(parent) = self.cache_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&registry) {
            let _ = fs::write(&self.cache_path, json);
        }

        // Update in-memory cache
        {
            let mut cached = self.cached.lock().unwrap();
            *cached = Some(CachedRegistry {
                registry: registry.clone(),
                fetched_at: Utc::now(),
            });
        }

        info!("Registry fetched: {} agents", registry.agents.len());
        Ok(registry)
    }

    pub fn get_cached(&self) -> Option<AcpRegistry> {
        // Check in-memory cache
        {
            let cached = self.cached.lock().unwrap();
            if let Some(c) = &*cached {
                return Some(c.registry.clone());
            }
        }

        // Try disk cache
        if self.cache_path.exists() {
            if let Ok(content) = fs::read_to_string(&self.cache_path) {
                if let Ok(registry) = serde_json::from_str::<AcpRegistry>(&content) {
                    let mut cached = self.cached.lock().unwrap();
                    *cached = Some(CachedRegistry {
                        registry: registry.clone(),
                        fetched_at: Utc::now(), // Treat disk cache as recent
                    });
                    return Some(registry);
                }
            }
        }

        None
    }

    pub async fn get_icon_svg(&self, agent_id: &str, icon: Option<&str>) -> Result<Option<String>, String> {
        let icon_url = match icon {
            Some(i) if i.starts_with("http") => i.to_string(),
            _ => format!("{}/registry/v1/latest/dist/{}.svg", CDN_URL, agent_id),
        };

        let client = reqwest::Client::new();
        match client.get(&icon_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                let text = resp.text().await.map_err(|e| e.to_string())?;
                Ok(Some(text))
            }
            _ => Ok(None),
        }
    }
}
