use std::fs;
use std::path::PathBuf;
use log::info;

pub struct DownloadService {
    downloads_dir: PathBuf,
    agents_dir: PathBuf,
}

impl DownloadService {
    pub fn new(data_dir: &PathBuf) -> Self {
        Self {
            downloads_dir: data_dir.join("downloads"),
            agents_dir: data_dir.join("agents"),
        }
    }

    /// Download and extract a binary agent, return the path to the executable
    pub async fn download_and_extract(
        &self,
        agent_id: &str,
        version: &str,
        archive_url: &str,
        cmd_name: &str,
    ) -> Result<String, String> {
        let install_dir = self.agents_dir.join(agent_id).join(version);
        fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&self.downloads_dir).map_err(|e| e.to_string())?;

        // Determine archive format from URL
        let archive_name = archive_url.split('/').last().unwrap_or("archive");
        let download_path = self.downloads_dir.join(archive_name);

        info!("Downloading agent {} from {}", agent_id, archive_url);

        // Download file
        let client = reqwest::Client::new();
        let bytes = client
            .get(archive_url)
            .send()
            .await
            .map_err(|e| format!("Download failed: {}", e))?
            .bytes()
            .await
            .map_err(|e| format!("Failed to read download: {}", e))?;

        fs::write(&download_path, &bytes).map_err(|e| e.to_string())?;

        // Extract based on file type
        let archive_lower = archive_url.to_lowercase();
        if archive_lower.ends_with(".tar.gz") || archive_lower.ends_with(".tgz") {
            self.extract_tar_gz(&download_path, &install_dir)?;
        } else if archive_lower.ends_with(".zip") {
            self.extract_zip(&download_path, &install_dir)?;
        } else if archive_lower.ends_with(".gz") {
            self.extract_gz(&download_path, &install_dir, cmd_name)?;
        } else {
            // Plain binary
            let dest = install_dir.join(cmd_name);
            fs::copy(&download_path, &dest).map_err(|e| e.to_string())?;
            self.make_executable(&dest)?;
        }

        // Clean up download
        let _ = fs::remove_file(&download_path);

        // Find the executable
        let executable = self.find_executable(&install_dir, cmd_name)?;
        info!("Agent {} installed at: {}", agent_id, executable);

        Ok(executable)
    }

    fn extract_tar_gz(&self, archive: &PathBuf, dest: &PathBuf) -> Result<(), String> {
        let file = fs::File::open(archive).map_err(|e| e.to_string())?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut tar = tar::Archive::new(gz);
        tar.unpack(dest).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn extract_zip(&self, archive: &PathBuf, dest: &PathBuf) -> Result<(), String> {
        let file = fs::File::open(archive).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        zip.extract(dest).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn extract_gz(&self, archive: &PathBuf, dest: &PathBuf, name: &str) -> Result<(), String> {
        let file = fs::File::open(archive).map_err(|e| e.to_string())?;
        let mut gz = flate2::read::GzDecoder::new(file);
        let out_path = dest.join(name);
        let mut out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut gz, &mut out_file).map_err(|e| e.to_string())?;
        self.make_executable(&out_path)?;
        Ok(())
    }

    fn make_executable(&self, path: &PathBuf) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(path, perms).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn find_executable(&self, dir: &PathBuf, cmd_name: &str) -> Result<String, String> {
        // Check exact name first
        let exact = dir.join(cmd_name);
        if exact.exists() {
            return Ok(exact.to_string_lossy().to_string());
        }

        // Check with .exe extension on Windows
        #[cfg(windows)]
        {
            let win = dir.join(format!("{}.exe", cmd_name));
            if win.exists() {
                return Ok(win.to_string_lossy().to_string());
            }
        }

        // Search recursively
        self.find_executable_recursive(dir, cmd_name)
            .ok_or_else(|| format!("Executable '{}' not found in {}", cmd_name, dir.display()))
    }

    fn find_executable_recursive(&self, dir: &PathBuf, name: &str) -> Option<String> {
        let entries = fs::read_dir(dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let file_name = path.file_name()?.to_str()?;
                if file_name == name || file_name == format!("{}.exe", name) {
                    return Some(path.to_string_lossy().to_string());
                }
            } else if path.is_dir() {
                if let Some(found) = self.find_executable_recursive(&path, name) {
                    return Some(found);
                }
            }
        }
        None
    }
}
