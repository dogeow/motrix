#[cfg(target_os = "macos")]
mod dock;
mod engine;
mod links;
mod tray;
mod upnp;

use base64::Engine as _;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

#[tauri::command]
fn get_engine_info(state: tauri::State<engine::EngineState>) -> Result<engine::EngineInfo, String> {
    if let Some(error) = state.error.lock().unwrap().clone() {
        return Err(error);
    }
    state
        .info
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "engine has not started yet".into())
}

#[tauri::command]
fn restart_engine(app: tauri::AppHandle) -> Result<(), String> {
    engine::restart(&app)
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

/// Create `path` if needed and verify the process can write inside it.
/// Used before retrying a task whose volume was just remounted.
#[tauri::command]
fn ensure_download_dir(path: String) -> Result<(), String> {
    use std::path::PathBuf;

    let dir = PathBuf::from(&path);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let probe = dir.join(".motrix-write-test");
    std::fs::write(&probe, b"ok").map_err(|error| error.to_string())?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

#[tauri::command]
fn dir_is_writable(path: String) -> bool {
    ensure_download_dir(path).is_ok()
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let target = std::path::Path::new(&path);
    match tauri_plugin_opener::reveal_item_in_dir(target) {
        Ok(()) => Ok(()),
        Err(error) => {
            // File may not exist yet; still open the parent so Finder lands nearby.
            let parent = target.parent().filter(|p| !p.as_os_str().is_empty());
            match parent {
                Some(parent) => {
                    tauri_plugin_opener::reveal_item_in_dir(parent).map_err(|e| e.to_string())
                }
                None => Err(error.to_string()),
            }
        }
    }
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

/// Move a task's downloaded files to the system trash.
///
/// Deliberately trashes ONLY the individual files aria2 registered for the
/// task — never a whole directory by name. A torrent called "example" may
/// land in a pre-existing `example/` folder holding unrelated user files;
/// trashing the folder wholesale (as Electron-era Motrix did) destroys them.
/// Directories the download created are removed afterwards only if they
/// ended up empty.
#[tauri::command]
fn trash_task_files(
    files: Vec<String>,
    base_dir: String,
    control_root: Option<String>,
) -> Result<usize, String> {
    use std::path::{Path, PathBuf};

    let base = Path::new(&base_dir);
    let mut trashed = 0usize;
    let mut parents: Vec<PathBuf> = Vec::new();

    for file in &files {
        let path = Path::new(file);
        let control = format!("{file}.aria2");
        if Path::new(&control).is_file() {
            let _ = trash::delete(&control);
        }
        if path.is_file() || path.is_symlink() {
            trash::delete(path).map_err(|e| e.to_string())?;
            trashed += 1;
        }
        if let Some(parent) = path.parent() {
            parents.push(parent.to_path_buf());
        }
    }

    // Multi-file BT tasks keep their control file at "<dir>/<name>.aria2".
    if let Some(root) = control_root {
        let control = format!("{root}.aria2");
        if Path::new(&control).is_file() {
            let _ = trash::delete(&control);
        }
    }

    // Clean up now-empty directories, deepest first, never crossing base_dir.
    // remove_dir() only succeeds on empty dirs, so user files are safe.
    parents.sort();
    parents.dedup();
    parents.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
    for parent in parents {
        let mut dir = parent;
        while dir.starts_with(base) && dir != base {
            let is_empty = std::fs::read_dir(&dir)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false);
            if !is_empty || std::fs::remove_dir(&dir).is_err() {
                break;
            }
            match dir.parent() {
                Some(p) => dir = p.to_path_buf(),
                None => break,
            }
        }
    }

    Ok(trashed)
}

/// Links/files handed over before the webview started listening.
#[tauri::command]
fn take_pending_targets(app: tauri::AppHandle) -> Vec<String> {
    links::take_pending(&app)
}

/// macOS shows the aggregate speed next to the menu bar icon.
#[tauri::command]
fn set_tray_title(app: tauri::AppHandle, title: Option<String>) {
    #[cfg(target_os = "macos")]
    if let Some(tray) = app.tray_by_id(tray::TRAY_ID) {
        let _ = tray.set_title(title.as_deref());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, title);
    }
}

#[tauri::command]
fn set_tray_tooltip(app: tauri::AppHandle, tooltip: String) {
    if let Some(tray) = app.tray_by_id(tray::TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

/// Show aggregate download/upload speeds over the macOS Dock icon.
#[tauri::command]
fn set_dock_speeds(
    app: tauri::AppHandle,
    download: Option<String>,
    upload: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.run_on_main_thread(move || {
            dock::set_speeds(download.as_deref(), upload.as_deref());
        })
        .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, download, upload);
        Ok(())
    }
}

/// Taskbar/Dock progress. `progress` is 0-100, or None to clear.
#[tauri::command]
fn set_progress(app: tauri::AppHandle, progress: Option<f64>) {
    use tauri::window::{ProgressBarState, ProgressBarStatus};

    if let Some(window) = app.get_webview_window("main") {
        let state = match progress {
            Some(value) => ProgressBarState {
                status: Some(ProgressBarStatus::Normal),
                progress: Some(value.clamp(0.0, 100.0) as u64),
            },
            None => ProgressBarState {
                status: Some(ProgressBarStatus::None),
                progress: None,
            },
        };
        let _ = window.set_progress_bar(state);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            tray::show_main_window(app);
            links::dispatch(app, links::filter_targets(args.iter().skip(1)));
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--opened-at-login"]),
        ))
        .manage(engine::EngineState::default())
        .manage(links::PendingTargets::default())
        .manage(upnp::UpnpState::default())
        .invoke_handler(tauri::generate_handler![
            get_engine_info,
            restart_engine,
            read_file_base64,
            path_exists,
            ensure_download_dir,
            dir_is_writable,
            reveal_in_folder,
            open_path,
            trash_task_files,
            take_pending_targets,
            set_tray_title,
            set_tray_tooltip,
            set_dock_speeds,
            set_progress
        ])
        .setup(|app| {
            let handle = app.handle();
            tray::create(handle)?;

            // A missing or broken sidecar must not stop the window from
            // opening — the UI surfaces the error and offers a retry.
            if let Err(error) = engine::start(handle) {
                eprintln!("[aria2] failed to start: {error}");
            }

            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let deep_link = app.deep_link();
                // Dev builds register the schemes at runtime; packaged builds
                // get them from the bundle configuration.
                #[cfg(debug_assertions)]
                let _ = deep_link.register_all();

                if let Ok(Some(urls)) = deep_link.get_current() {
                    let targets = links::filter_targets(urls.iter().map(|url| url.to_string()));
                    links::dispatch(handle, targets);
                }

                let link_handle = handle.clone();
                deep_link.on_open_url(move |event| {
                    let targets =
                        links::filter_targets(event.urls().iter().map(|url| url.to_string()));
                    links::dispatch(&link_handle, targets);
                });
            }

            links::dispatch(handle, links::filter_targets(std::env::args().skip(1)));
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps downloads running in the tray; quitting
            // happens from the tray menu or the app menu.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => engine::shutdown(app),
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                let targets = links::filter_targets(urls.iter().map(|url| url.to_string()));
                links::dispatch(app, targets);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => tray::show_main_window(app),
            _ => {}
        });
}
