use std::fs;
use std::path::{Path, PathBuf};

fn rust_files(path: &Path, output: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(path).expect("domain source directory must exist") {
        let path = entry.expect("domain source entry must be readable").path();
        if path.is_dir() {
            rust_files(&path, output);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            output.push(path);
        }
    }
}

#[test]
fn domain_has_no_outward_dependencies() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../backend/crates/domain");
    let manifest =
        fs::read_to_string(root.join("Cargo.toml")).expect("domain manifest must be readable");
    let forbidden_packages = [
        "axum",
        "reqwest",
        "appwrite",
        "opentelemetry",
        "tracing",
        "mongodb",
        "redis",
        "openai",
        "whisper",
        "dexie",
        "react",
    ];
    for package in forbidden_packages {
        assert!(
            !manifest.to_ascii_lowercase().contains(package),
            "forbidden domain dependency: {package}"
        );
    }

    let mut files = Vec::new();
    rust_files(&root.join("src"), &mut files);
    for file in files {
        let source = fs::read_to_string(&file).expect("domain source must be readable");
        for namespace in [
            "axum::",
            "reqwest::",
            "appwrite",
            "opentelemetry",
            "tracing::",
            "mongodb::",
            "redis::",
            "openai",
            "whisper",
        ] {
            assert!(
                !source.to_ascii_lowercase().contains(namespace),
                "{} imports {namespace}",
                file.display()
            );
        }
    }
}
