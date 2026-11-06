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

    tauri_build::build();
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // Tauri 集成测试使用与应用相同的 Windows 公共控件清单。
        let resource = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("resource.lib");
        println!("cargo:rustc-link-arg-tests={}", resource.display());
    }
}
