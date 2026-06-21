const reservedShortcuts = new Set([
  "Ctrl+C",
  "Command+C",
  "Ctrl+V",
  "Command+V",
  "Ctrl+X",
  "Command+X",
  "Ctrl+A",
  "Command+A",
  "Ctrl+Z",
  "Command+Z",
  "Ctrl+Y",
  "Command+Shift+Z"
]);

export function validateShortcut(shortcut: string): string | null {
  if (!shortcut.includes("+")) {
    return "Shortcut must include at least one modifier key.";
  }
  if (reservedShortcuts.has(shortcut)) {
    return `${shortcut} is reserved by normal editing/copy behavior. Pick a less common shortcut.`;
  }
  return null;
}

