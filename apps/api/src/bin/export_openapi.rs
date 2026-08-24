use std::{env, fs, path::PathBuf, process::ExitCode};

use cashmemo_api::openapi::ApiDoc;

fn main() -> ExitCode {
    let Some(path) = env::args_os().nth(1).map(PathBuf::from) else {
        eprintln!("usage: export_openapi <output-path>");
        return ExitCode::FAILURE;
    };

    let document = match serde_json::to_string_pretty(&ApiDoc::openapi()) {
        Ok(document) => format!("{document}\n"),
        Err(error) => {
            eprintln!("failed to serialize OpenAPI: {error}");
            return ExitCode::FAILURE;
        }
    };
    if let Some(parent) = path.parent()
        && let Err(error) = fs::create_dir_all(parent)
    {
        eprintln!("failed to create {}: {error}", parent.display());
        return ExitCode::FAILURE;
    }
    if let Err(error) = fs::write(&path, document) {
        eprintln!("failed to write {}: {error}", path.display());
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
