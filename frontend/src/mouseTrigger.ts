import { invoke } from "@tauri-apps/api/core";
import type { MouseTriggerSettings } from "./types";

export type MouseTriggerStatus = {
  available: boolean;
  backend: string;
  message: string;
  active: boolean;
  recording: boolean;
  grabbed_button: number | null;
  last_error: string | null;
};

export type MouseTriggerRecorded = {
  button: number;
};

export async function getMouseTriggerStatus(): Promise<MouseTriggerStatus> {
  return invoke<MouseTriggerStatus>("mouse_trigger_status");
}

export async function configureMouseTrigger(settings: MouseTriggerSettings): Promise<void> {
  return invoke("configure_mouse_trigger", { config: settings });
}

export async function startMouseTriggerRecording(timeoutMs = 8000): Promise<void> {
  return invoke("start_mouse_trigger_recording", { timeoutMs });
}

export async function stopMouseTriggerRecording(): Promise<void> {
  return invoke("stop_mouse_trigger_recording");
}
