use base64::Engine;
use tauri::Manager;

/// 区域截图：选区 → 裁剪 → 弹出导入窗
#[tauri::command]
pub async fn crop_screenshot(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    eprintln!(
        "[DEBUG] crop_screenshot called: x={}, y={}, w={}, h={}",
        x, y, width, height
    );
    let png_bytes = capture_screen_region(x, y, width, height)?;
    eprintln!("[DEBUG] captured {} bytes", png_bytes.len());
    let base64_img = base64::engine::general_purpose::STANDARD.encode(&png_bytes);

    // 弹出导入窗（截图预览，文本由用户手动输入）
    eprintln!("[DEBUG] showing import window...");
    if let Some(win) = app.get_webview_window("import") {
        let _ = win.show();
        let _ = win.set_focus();
        let data = serde_json::json!({"text": "", "image_base64": base64_img});
        let _ = win.eval(format!("window.__screenshotResult = {};", data));
        eprintln!("[DEBUG] import window shown + data sent");
    } else {
        eprintln!("[DEBUG] import window not found!");
    }
    Ok(())
}

#[cfg(windows)]
fn capture_screen_region(x: i32, y: i32, w: i32, h: i32) -> Result<Vec<u8>, String> {
    use windows::Win32::Graphics::Gdi::*;

    unsafe {
        let hdc_screen = GetDC(None);
        if hdc_screen.is_invalid() {
            return Err("获取屏幕 DC 失败".into());
        }
        let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
        if hdc_mem.is_invalid() {
            let _ = ReleaseDC(None, hdc_screen);
            return Err("创建内存 DC 失败".into());
        }
        let hbmp = CreateCompatibleBitmap(hdc_screen, w, h);
        if hbmp.is_invalid() {
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(None, hdc_screen);
            return Err("创建位图失败".into());
        }
        let old = SelectObject(hdc_mem, hbmp.into());
        let _ = BitBlt(hdc_mem, 0, 0, w, h, Some(hdc_screen), x, y, SRCCOPY);
        let png = bitmap_to_png(hbmp, w, h)?;
        SelectObject(hdc_mem, old);
        let _ = DeleteObject(hbmp.into());
        let _ = DeleteDC(hdc_mem);
        let _ = ReleaseDC(None, hdc_screen);
        Ok(png)
    }
}

#[cfg(windows)]
fn bitmap_to_png(
    hbitmap: windows::Win32::Graphics::Gdi::HBITMAP,
    w: i32,
    h: i32,
) -> Result<Vec<u8>, String> {
    use windows::Win32::Graphics::Gdi::*;

    unsafe {
        let hdc = CreateCompatibleDC(None);
        if hdc.is_invalid() {
            return Err("创建 DC 失败".into());
        }
        let mut bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [RGBQUAD::default(); 1],
        };
        let mut pixels = vec![0u8; (w * h * 4) as usize];
        GetDIBits(
            hdc,
            hbitmap,
            0,
            h as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bi,
            DIB_RGB_COLORS,
        );
        let _ = DeleteDC(hdc);
        encode_png(&pixels, w as u32, h as u32)
    }
}

#[allow(dead_code)]
fn encode_png(pixels: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, width, height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut w = enc
            .write_header()
            .map_err(|e| format!("PNG 头失败: {}", e))?;
        w.write_image_data(pixels)
            .map_err(|e| format!("PNG 数据失败: {}", e))?;
    }
    Ok(out)
}

#[cfg(not(windows))]
fn capture_screen_region(_x: i32, _y: i32, _w: i32, _h: i32) -> Result<Vec<u8>, String> {
    Err("截屏仅支持 Windows".into())
}
