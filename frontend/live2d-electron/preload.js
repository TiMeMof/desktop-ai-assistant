const { contextBridge, ipcRenderer } = require("electron");

let startX = 0;
let startY = 0;
let isDragging = false;

contextBridge.exposeInMainWorld("electronAPI", {
  startDrag: (x, y) => {
    isDragging = true;
    startX = x;
    startY = y;
  },
  doDrag: (x, y) => {
    if (!isDragging) return;
    ipcRenderer.send("window-move", { dx: x - startX, dy: y - startY });
    startX = x;
    startY = y;
  },
  endDrag: () => {
    isDragging = false;
  }
});
