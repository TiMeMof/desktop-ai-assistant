const { app, BrowserWindow, clipboard, ipcMain } = require("electron");
const { execFile } = require("child_process");

let mainWindow = null;
const live2dUrl = "http://127.0.0.1:1420/live2d.html";

app.commandLine.appendSwitch("enable-transparent-visuals");

if (process.env.LIVE2D_DISABLE_GPU === "1") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 540,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: process.platform === "linux",
    hasShadow: false,
    resizable: true,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: require("path").join(__dirname, "preload.js")
    }
  });

  mainWindow.setIgnoreMouseEvents(false);
  loadLive2DUrl();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function loadLive2DUrl(attempt = 1) {
  if (!mainWindow) return;
  mainWindow.loadURL(live2dUrl).catch(() => {
    if (attempt >= 40) return;
    setTimeout(() => loadLive2DUrl(attempt + 1), 250);
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});

ipcMain.on("window-move", (event, payload) => {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  mainWindow.setBounds({
    x: bounds.x + payload.dx,
    y: bounds.y + payload.dy,
    width: bounds.width,
    height: bounds.height
  });
});

ipcMain.handle("window-focusable", (_event, focusable) => {
  if (!mainWindow) return;
  mainWindow.setFocusable(Boolean(focusable));
  if (focusable) {
    mainWindow.focus();
  }
});

function simulateCopy() {
  return new Promise((resolve, reject) => {
    if (process.platform === "darwin") {
      execFile(
        "osascript",
        ["-e", "tell application \"System Events\" to keystroke \"c\" using command down"],
        (err) => err ? reject(new Error(`osascript failed to send Command+C: ${err.message}`)) : resolve()
      );
      return;
    }

    if (process.platform === "win32") {
      execFile(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')"
        ],
        (err) => err ? reject(new Error(`PowerShell failed to send Ctrl+C: ${err.message}`)) : resolve()
      );
      return;
    }

    execFile("xdotool", ["key", "ctrl+c"], (err) => {
      if (err) {
        reject(new Error(`xdotool is required to capture selected text on Linux: ${err.message}`));
        return;
      }
      resolve();
    });
  });
}

function readLinuxPrimarySelection() {
  const commands = [
    ["wl-paste", ["--primary", "--no-newline"]],
    ["xclip", ["-selection", "primary", "-out"]],
    ["xsel", ["--primary", "--output"]]
  ];

  return new Promise((resolve, reject) => {
    function tryCommand(index) {
      if (index >= commands.length) {
        resolve("");
        return;
      }
      const [command, args] = commands[index];
      execFile(command, args, { timeout: 1000 }, (err, stdout) => {
        if (!err && stdout.trim()) {
          resolve(stdout.trim());
          return;
        }
        tryCommand(index + 1);
      });
    }
    tryCommand(0);
  });
}

ipcMain.handle("capture-selected-text", async (_event, restoreClipboard = true) => {
  if (process.platform === "linux") {
    const selected = await readLinuxPrimarySelection();
    return (selected || clipboard.readText() || "").trim();
  }

  const previous = clipboard.readText();
  await simulateCopy();
  await new Promise((resolve) => setTimeout(resolve, 180));
  const selected = clipboard.readText();
  if (restoreClipboard && previous !== selected) {
    clipboard.writeText(previous ?? "");
  }
  return (selected ?? "").trim();
});

ipcMain.handle("read-clipboard-text", () => {
  return (clipboard.readText() ?? "").trim();
});
