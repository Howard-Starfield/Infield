#[cfg(not(target_os = "windows"))]
use enigo::Key;
use enigo::{Enigo, Keyboard, Mouse, Settings};
use log::{debug, info};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Wrapper for Enigo to store in Tauri's managed state.
/// Enigo is wrapped in a Mutex since it requires mutable access.
pub struct EnigoState(pub Mutex<Enigo>);

impl EnigoState {
    pub fn new() -> Result<Self, String> {
        let enigo = Enigo::new(&Settings::default())
            .map_err(|e| format!("Failed to initialize Enigo: {}", e))?;
        Ok(Self(Mutex::new(enigo)))
    }
}

/// Get the current mouse cursor position using the managed Enigo instance.
/// Returns None if the state is not available or if getting the location fails.
pub fn get_cursor_position(app_handle: &AppHandle) -> Option<(i32, i32)> {
    let enigo_state = app_handle.try_state::<EnigoState>()?;
    let enigo = enigo_state.0.lock().ok()?;
    enigo.location().ok()
}

/// Sends a Ctrl+V or Cmd+V paste command using platform-specific virtual key codes.
/// This ensures the paste works regardless of keyboard layout (e.g., Russian, AZERTY, DVORAK).
/// Note: On Wayland, this may not work - callers should check for Wayland and use alternative methods.
pub fn send_paste_ctrl_v(enigo: &mut Enigo) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Same root cause as `send_paste_shift_insert`: Enigo's modifier path can fault
        // (ACCESS_VIOLATION in GetKeyboardLayout / MapVirtualKeyExW). Use SendInput.
        let _ = enigo;
        return windows_send_ctrl_v_combo();
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Platform-specific key definitions
        #[cfg(target_os = "macos")]
        let (modifier_key, v_key_code) = (Key::Meta, Key::Other(9));
        #[cfg(target_os = "linux")]
        let (modifier_key, v_key_code) = (Key::Control, Key::Unicode('v'));

        // Press modifier + V
        enigo
            .key(modifier_key, enigo::Direction::Press)
            .map_err(|e| format!("Failed to press modifier key: {}", e))?;
        enigo
            .key(v_key_code, enigo::Direction::Click)
            .map_err(|e| format!("Failed to click V key: {}", e))?;

        std::thread::sleep(std::time::Duration::from_millis(100));

        enigo
            .key(modifier_key, enigo::Direction::Release)
            .map_err(|e| format!("Failed to release modifier key: {}", e))?;

        Ok(())
    }
}

/// Sends a Ctrl+Shift+V paste command.
/// This is commonly used in terminal applications on Linux to paste without formatting.
/// Note: On Wayland, this may not work - callers should check for Wayland and use alternative methods.
pub fn send_paste_ctrl_shift_v(enigo: &mut Enigo) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = enigo;
        return windows_send_ctrl_shift_v_combo();
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Platform-specific key definitions
        #[cfg(target_os = "macos")]
        let (modifier_key, v_key_code) = (Key::Meta, Key::Other(9)); // Cmd+Shift+V on macOS
        #[cfg(target_os = "linux")]
        let (modifier_key, v_key_code) = (Key::Control, Key::Unicode('v'));

        // Press Ctrl/Cmd + Shift + V
        enigo
            .key(modifier_key, enigo::Direction::Press)
            .map_err(|e| format!("Failed to press modifier key: {}", e))?;
        enigo
            .key(Key::Shift, enigo::Direction::Press)
            .map_err(|e| format!("Failed to press Shift key: {}", e))?;
        enigo
            .key(v_key_code, enigo::Direction::Click)
            .map_err(|e| format!("Failed to click V key: {}", e))?;

        std::thread::sleep(std::time::Duration::from_millis(100));

        enigo
            .key(Key::Shift, enigo::Direction::Release)
            .map_err(|e| format!("Failed to release Shift key: {}", e))?;
        enigo
            .key(modifier_key, enigo::Direction::Release)
            .map_err(|e| format!("Failed to release modifier key: {}", e))?;

        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn windows_send_ctrl_v_combo() -> Result<(), String> {
    use std::mem::size_of;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };

    const VK_CONTROL: u16 = 0x11;
    const VK_V: u16 = 0x56;

    let make_key = |vk: u16, flags: KEYBD_EVENT_FLAGS| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let press = [
        make_key(VK_CONTROL, KEYBD_EVENT_FLAGS::default()),
        make_key(VK_V, KEYBD_EVENT_FLAGS::default()),
        make_key(VK_V, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe { SendInput(&press, size_of::<INPUT>() as i32) };
    if sent as usize != press.len() {
        return Err(format!(
            "SendInput (Ctrl+V) press sent {}/{} events",
            sent,
            press.len()
        ));
    }
    std::thread::sleep(std::time::Duration::from_millis(100));
    let release = [make_key(VK_CONTROL, KEYEVENTF_KEYUP)];
    let sent = unsafe { SendInput(&release, size_of::<INPUT>() as i32) };
    if sent as usize != release.len() {
        return Err(format!(
            "SendInput (Ctrl+V) release sent {}/{} events",
            sent,
            release.len()
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_send_ctrl_shift_v_combo() -> Result<(), String> {
    use std::mem::size_of;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };

    const VK_CONTROL: u16 = 0x11;
    const VK_SHIFT: u16 = 0x10;
    const VK_V: u16 = 0x56;

    let make_key = |vk: u16, flags: KEYBD_EVENT_FLAGS| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let press = [
        make_key(VK_CONTROL, KEYBD_EVENT_FLAGS::default()),
        make_key(VK_SHIFT, KEYBD_EVENT_FLAGS::default()),
        make_key(VK_V, KEYBD_EVENT_FLAGS::default()),
        make_key(VK_V, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe { SendInput(&press, size_of::<INPUT>() as i32) };
    if sent as usize != press.len() {
        return Err(format!(
            "SendInput (Ctrl+Shift+V) press sent {}/{} events",
            sent,
            press.len()
        ));
    }
    std::thread::sleep(std::time::Duration::from_millis(100));
    let release = [
        make_key(VK_SHIFT, KEYEVENTF_KEYUP),
        make_key(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe { SendInput(&release, size_of::<INPUT>() as i32) };
    if sent as usize != release.len() {
        return Err(format!(
            "SendInput (Ctrl+Shift+V) release sent {}/{} events",
            sent,
            release.len()
        ));
    }
    Ok(())
}

/// Sends a Shift+Insert paste command (Windows and Linux only).
/// This is more universal for terminal applications and legacy software.
/// Note: On Wayland, this may not work - callers should check for Wayland and use alternative methods.
pub fn send_paste_shift_insert(enigo: &mut Enigo) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Bypass Enigo entirely on Windows — enigo.key() with modifier keys causes
        // an ACCESS_VIOLATION crash (likely in its GetKeyboardLayout/MapVirtualKeyExW path).
        // Use SendInput directly instead.
        use std::mem::size_of;
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
            KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VIRTUAL_KEY,
        };

        const VK_SHIFT: u16 = 0x10;
        const VK_INSERT: u16 = 0x2D;

        let make_key = |vk: u16, flags: KEYBD_EVENT_FLAGS| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };

        let inputs = [
            make_key(VK_SHIFT, KEYBD_EVENT_FLAGS::default()), // Shift down
            make_key(VK_INSERT, KEYEVENTF_EXTENDEDKEY),       // Insert down
            make_key(VK_INSERT, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP), // Insert up
            make_key(VK_SHIFT, KEYEVENTF_KEYUP),              // Shift up
        ];

        info!("send_paste_shift_insert: sending Shift+Insert via SendInput");
        let sent = unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
        if sent as usize != inputs.len() {
            return Err(format!("SendInput sent {}/{} events", sent, inputs.len()));
        }
        info!("send_paste_shift_insert: done");
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let insert_key_code = Key::Other(0x76); // XK_Insert

        info!("send_paste_shift_insert: pressing Shift");
        enigo
            .key(Key::Shift, enigo::Direction::Press)
            .map_err(|e| format!("Failed to press Shift key: {}", e))?;
        info!("send_paste_shift_insert: Shift pressed, clicking Insert");
        enigo
            .key(insert_key_code, enigo::Direction::Click)
            .map_err(|e| format!("Failed to click Insert key: {}", e))?;
        info!("send_paste_shift_insert: Insert clicked, sleeping 100ms");
        std::thread::sleep(std::time::Duration::from_millis(100));
        info!("send_paste_shift_insert: releasing Shift");
        enigo
            .key(Key::Shift, enigo::Direction::Release)
            .map_err(|e| format!("Failed to release Shift key: {}", e))?;
        info!("send_paste_shift_insert: done");
        Ok(())
    }
}

/// Auto-submit after paste: avoid Enigo on Windows (modifier / key paths can ACCESS_VIOLATION).
#[cfg(target_os = "windows")]
pub fn windows_send_auto_submit_return(
    key_type: crate::settings::AutoSubmitKey,
) -> Result<(), String> {
    use std::mem::size_of;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY,
        KEYEVENTF_KEYUP, VIRTUAL_KEY,
    };

    const VK_RETURN: u16 = 0x0D;
    const VK_CONTROL: u16 = 0x11;
    const VK_LWIN: u16 = 0x5B;

    let make_key = |vk: u16, flags: KEYBD_EVENT_FLAGS| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let send = |inputs: &[INPUT]| -> Result<(), String> {
        let sent = unsafe { SendInput(inputs, size_of::<INPUT>() as i32) };
        if sent as usize != inputs.len() {
            return Err(format!(
                "SendInput (auto-submit) sent {}/{} events",
                sent,
                inputs.len()
            ));
        }
        Ok(())
    };

    match key_type {
        crate::settings::AutoSubmitKey::Enter => {
            let seq = [
                make_key(
                    VK_RETURN,
                    KEYEVENTF_EXTENDEDKEY,
                ),
                make_key(
                    VK_RETURN,
                    KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP,
                ),
            ];
            send(&seq)?;
        }
        crate::settings::AutoSubmitKey::CtrlEnter => {
            let press = [
                make_key(VK_CONTROL, KEYBD_EVENT_FLAGS::default()),
                make_key(VK_RETURN, KEYEVENTF_EXTENDEDKEY),
                make_key(VK_RETURN, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP),
            ];
            send(&press)?;
            let release = [make_key(VK_CONTROL, KEYEVENTF_KEYUP)];
            send(&release)?;
        }
        crate::settings::AutoSubmitKey::CmdEnter => {
            let press = [
                make_key(VK_LWIN, KEYBD_EVENT_FLAGS::default()),
                make_key(VK_RETURN, KEYEVENTF_EXTENDEDKEY),
                make_key(VK_RETURN, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP),
            ];
            send(&press)?;
            let release = [make_key(VK_LWIN, KEYEVENTF_KEYUP)];
            send(&release)?;
        }
    }

    Ok(())
}

/// Pastes text directly using the enigo text method.
/// This tries to use system input methods if possible, otherwise simulates keystrokes one by one.
#[cfg(not(target_os = "windows"))]
pub fn paste_text_direct(enigo: &mut Enigo, text: &str) -> Result<(), String> {
    enigo
        .text(text)
        .map_err(|e| format!("Failed to send text directly: {}", e))?;

    Ok(())
}
