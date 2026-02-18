use serde_json::{json, Value as JsonValue};
use crate::error::Result;

#[tauri::command]
pub async fn system_wsl_info() -> Result<JsonValue> {
    // WSL detection (Windows only)
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("wsl")
            .args(["--list", "--quiet"])
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                let distros: Vec<String> = String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .filter(|l| !l.trim().is_empty())
                    .map(|l| l.trim().to_string())
                    .collect();

                return Ok(json!({
                    "available": true,
                    "distributions": distros
                }));
            }
        }
    }

    Ok(json!({
        "available": false,
        "distributions": []
    }))
}
