const { app, BrowserWindow } = require('electron');
const path   = require('path');
const fs     = require('fs');
const { spawn } = require('child_process');
const { setMainWindow } = require('./shared');

// Register all IPC handlers at startup
require('./ipc/window');
require('./ipc/store');
require('./scraper/sync');
require('./creator');
const { initAutoUpdater, startUpdateCheck } = require('./ipc/updater');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100, height: 760, minWidth: 900, minHeight: 600,
    frame: false, backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

async function ensurePlaywrightChromium() {
  const { chromium } = require('playwright');
  let installed = false;
  try {
    installed = fs.existsSync(chromium.executablePath());
  } catch (_) {
    installed = false;
  }

  if (installed) {
    mainWindow.webContents.send('playwright-status', { stage: 'ready' });
    return;
  }

  mainWindow.webContents.send('playwright-status', { stage: 'installing', message: 'Setting up browser — this only happens once…' });

  await new Promise((resolve) => {
    let playwrightCli;
    try { playwrightCli = require.resolve('playwright/cli'); }
    catch (_) { playwrightCli = require.resolve('playwright-core/cli'); }

    const proc = spawn(process.execPath, [playwrightCli, 'install', 'chromium'], {
      stdio: 'pipe',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });

    const onData = d => {
      const msg = d.toString().trim();
      if (msg) mainWindow.webContents.send('playwright-status', { stage: 'installing', message: msg });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('close', code => {
      mainWindow.webContents.send('playwright-status', {
        stage: code === 0 ? 'ready' : 'error',
        message: code === 0 ? 'Browser ready!' : 'Browser setup failed — run: npm run install-playwright'
      });
      resolve();
    });
  });
}

app.whenReady().then(async () => {
  initAutoUpdater();
  createWindow();
  setMainWindow(mainWindow);

  mainWindow.webContents.once('did-finish-load', async () => {
    await ensurePlaywrightChromium();
    startUpdateCheck();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });