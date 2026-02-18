use tauri::{AppHandle, Manager, Runtime};
use crate::error::{AppError, Result};

#[tauri::command]
pub async fn window_reload(app: AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.eval("window.location.reload()").map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn window_toggle_devtools(app: AppHandle) -> Result<()> {
    #[cfg(debug_assertions)]
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
    }
    Ok(())
}

#[tauri::command]
pub async fn window_reset_zoom(app: AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("document.body.style.zoom = '100%'");
    }
    Ok(())
}

#[tauri::command]
pub async fn window_zoom_in(app: AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("document.body.style.zoom = (parseFloat(document.body.style.zoom || '1') + 0.1) + ''");
    }
    Ok(())
}

#[tauri::command]
pub async fn window_zoom_out(app: AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("document.body.style.zoom = Math.max(0.5, parseFloat(document.body.style.zoom || '1') - 0.1) + ''");
    }
    Ok(())
}

#[tauri::command]
pub async fn window_toggle_fullscreen(app: AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let is_fullscreen = window.is_fullscreen().unwrap_or(false);
        let _ = window.set_fullscreen(!is_fullscreen);
    }
    Ok(())
}

#[tauri::command]
pub async fn window_minimize(app: AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
    }
    Ok(())
}

#[tauri::command]
pub async fn window_close(app: AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
    Ok(())
}

#[tauri::command]
pub async fn window_quit(app: AppHandle) -> Result<()> {
    app.exit(0);
    Ok(())
}
