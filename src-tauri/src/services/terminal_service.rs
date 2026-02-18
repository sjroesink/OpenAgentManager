use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use uuid::Uuid;
use log::{error, info};
use tauri::AppHandle;
use serde_json::json;

struct TerminalInstance {
    writer: Box<dyn portable_pty::MasterPty + Send>,
    session_id: String,
}

pub struct TerminalService {
    terminals: HashMap<String, TerminalInstance>,
}

impl TerminalService {
    pub fn new() -> Self {
        Self {
            terminals: HashMap::new(),
        }
    }

    pub fn create(
        &mut self,
        cwd: &str,
        session_id: &str,
        shell: Option<&str>,
        app_handle: &AppHandle,
    ) -> Result<String, String> {
        let terminal_id = Uuid::new_v4().to_string();

        let pty_system = native_pty_system();

        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| format!("Failed to open PTY: {}", e))?;

        let default_shell = get_default_shell();
        let shell_cmd = shell.unwrap_or(&default_shell);

        let mut cmd = CommandBuilder::new(shell_cmd);
        cmd.cwd(cwd);

        pair.slave.spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        // Spawn reader task
        let mut reader = pair.master.try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let terminal_id_clone = terminal_id.clone();
        let app_handle_clone = app_handle.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_handle_clone.emit("terminal:data", json!({
                            "terminalId": terminal_id_clone,
                            "data": data
                        }));
                    }
                    Err(_) => break,
                }
            }
            info!("Terminal {} reader exited", terminal_id_clone);
        });

        self.terminals.insert(terminal_id.clone(), TerminalInstance {
            writer: pair.master,
            session_id: session_id.to_string(),
        });

        info!("Terminal created: {}", terminal_id);
        Ok(terminal_id)
    }

    pub fn write(&mut self, terminal_id: &str, data: &str) -> Result<(), String> {
        let terminal = self.terminals.get_mut(terminal_id)
            .ok_or_else(|| format!("Terminal not found: {}", terminal_id))?;
        terminal.writer.write_all(data.as_bytes())
            .map_err(|e| e.to_string())
    }

    pub fn resize(&mut self, terminal_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let terminal = self.terminals.get_mut(terminal_id)
            .ok_or_else(|| format!("Terminal not found: {}", terminal_id))?;
        terminal.writer.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| e.to_string())
    }

    pub fn kill(&mut self, terminal_id: &str) {
        self.terminals.remove(terminal_id);
        info!("Terminal killed: {}", terminal_id);
    }

    pub fn kill_all(&mut self) {
        self.terminals.clear();
    }
}

// portable-pty's MasterPty needs write_all
trait WriteAll {
    fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()>;
}

impl WriteAll for Box<dyn portable_pty::MasterPty + Send> {
    fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()> {
        use std::io::Write;
        let mut writer = self.take_writer().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        writer.write_all(buf)
    }
}

// std::io::Read for pty reader
use std::io::Read;

fn get_default_shell() -> String {
    if cfg!(target_os = "windows") {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        })
    }
}
