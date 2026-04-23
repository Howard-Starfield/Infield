import { convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { type } from "@tauri-apps/plugin-os";

/**
 * Turn an absolute on-disk path into a URL the webview can play in `<audio src>`.
 * Matches history / grid: Linux uses a blob URL; Windows/macOS use asset protocol.
 */
export async function localAudioFilePathToUrl(
  absolutePath: string | null | undefined,
): Promise<string | null> {
  const p = absolutePath?.trim();
  if (!p) return null;

  try {
    const osType = type();
    if (osType === "linux") {
      const fileData = await readFile(p);
      return URL.createObjectURL(new Blob([fileData], { type: "audio/wav" }));
    }
    return convertFileSrc(p, "asset");
  } catch (e) {
    console.warn(
      "[localAudioFilePathToUrl] failed",
      p.slice(-80),
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
