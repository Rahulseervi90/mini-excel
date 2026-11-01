// Mini Excel - the Electron "picture frame".
// Electron opens a desktop window and shows index.html inside it.
const { app, BrowserWindow } = require('electron');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Mini Excel',
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  // On a Mac, clicking the dock icon should reopen a window if none is open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Closing the last window quits the app (except on a Mac, where apps stay alive).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
