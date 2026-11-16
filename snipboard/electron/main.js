const { app, BrowserWindow, ipcMain, clipboard, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win;
let normalBounds;

const vaultPath = () => path.join(app.getPath('userData'), 'snipboard-vault.json');

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 720, minWidth: 320, minHeight: 400,
    title: 'SnipBoard',
    backgroundColor: '#f4f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
  // The app never navigates away or opens windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}

ipcMain.handle('vault:load', () => {
  for (const p of [vaultPath(), vaultPath() + '.bak']) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* try the backup copy */ }
  }
  return null;
});

ipcMain.handle('vault:save', (_e, obj) => {
  const p = vaultPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak');
  fs.renameSync(tmp, p);
});

ipcMain.handle('clip:write', (_e, c) => {
  const data = { text: String(c.text) };
  if (c.html) data.html = String(c.html);
  clipboard.write(data);
});

ipcMain.handle('clip:clearIf', (_e, text) => {
  if (clipboard.readText() === text) clipboard.clear();
});

ipcMain.handle('file:save', async (_e, name, content) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), path.basename(String(name))) });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, String(content));
  shell.showItemInFolder(r.filePath);
  return true;
});

ipcMain.handle('win:mini', (_e, on) => {
  if (!win) return;
  if (on) {
    normalBounds = win.getBounds();
    if (win.isMaximized()) win.unmaximize();
    win.setAlwaysOnTop(true, 'floating');
    win.setSize(360, 560);
  } else {
    win.setAlwaysOnTop(false);
    if (normalBounds) win.setBounds(normalBounds);
  }
});
