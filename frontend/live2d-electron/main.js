const { app, BrowserWindow, ipcMain } = require("electron");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 540,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: require("path").join(__dirname, "preload.js")
    }
  });

  mainWindow.loadURL("http://127.0.0.1:1420/live2d.html");

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.commandLine.appendSwitch("enable-transparent-visuals");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");

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
