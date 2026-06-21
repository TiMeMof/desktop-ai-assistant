import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

export async function captureSelectedText(restoreClipboard: boolean): Promise<string> {
  const previous = await readText().catch(() => "");
  await invoke("simulate_copy");
  await new Promise((resolve) => window.setTimeout(resolve, 180));
  const selected = await readText().catch(() => "");
  if (restoreClipboard && previous !== selected) {
    await writeText(previous ?? "");
  }
  return selected?.trim() ?? "";
}

