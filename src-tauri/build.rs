use std::env;
use std::path::PathBuf;

fn main() {
    let env_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(".env");
    println!("cargo:rerun-if-changed={}", env_path.display());
    println!("cargo:rerun-if-env-changed=PDF_TO_WORD_BASE_URL");

    let env_file_value = dotenvy::from_path_iter(&env_path).ok().and_then(|entries| {
        entries
            .filter_map(Result::ok)
            .find(|(key, _)| key == "PDF_TO_WORD_BASE_URL")
            .map(|(_, value)| value)
    });
    let value = env_file_value.or_else(|| env::var("PDF_TO_WORD_BASE_URL").ok());
    if let Some(value) = value {
        println!("cargo:rustc-env=PDF_TO_WORD_BASE_URL={value}");
    }

    tauri_build::build()
}
