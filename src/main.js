const { app, BrowserWindow } = require('electron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const { spawn } = require('child_process');
const { setMainWindow } = require('./shared');

// Pin Playwright's browser path to an app-specific directory so it never collides
// with other Playwright-based software (e.g. other Electron apps) that may have a
// partial ms-playwright installation. Must be set before any playwright require.
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'),
  'cloaked-manager-browsers'
);

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

function pwLog(msg) {
  mainWindow.webContents.send('playwright-status', { stage: 'installing', message: msg });
  mainWindow.webContents.send('debug-log', { panel: 'sync', level: 'verbose', message: `[PW-INSTALL] ${msg}`, ts: new Date().toISOString() });
}

async function ensurePlaywrightChromium() {
  pwLog(`execPath: ${process.execPath}`);
  pwLog(`PLAYWRIGHT_BROWSERS_PATH: ${process.env.PLAYWRIGHT_BROWSERS_PATH || '(not set)'}`);
  pwLog(`ELECTRON_RUN_AS_NODE in env: ${process.env.ELECTRON_RUN_AS_NODE || '(not set)'}`);

  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const alreadyInstalled = browsersPath &&
    fs.existsSync(browsersPath) &&
    fs.readdirSync(browsersPath).some(d => d.startsWith('chromium_headless_shell'));

  if (alreadyInstalled) {
    pwLog('chromium_headless_shell already present — skipping install');
    mainWindow.webContents.send('playwright-status', { stage: 'ready' });
    return;
  }

  pwLog('chromium_headless_shell not found — starting install…');
  mainWindow.webContents.send('playwright-status', { stage: 'installing', message: 'Setting up browser — this only happens once…' });

  let playwrightCli;
  try {
    playwrightCli = require.resolve('playwright/cli');
    pwLog(`playwright CLI resolved to: ${playwrightCli}`);
  } catch (e) {
    try {
      playwrightCli = require.resolve('playwright-core/cli');
      pwLog(`playwright-core CLI resolved to: ${playwrightCli}`);
    } catch (e2) {
      pwLog(`ERROR: Could not resolve playwright CLI: ${e2.message}`);
      mainWindow.webContents.send('playwright-status', { stage: 'error', message: 'Browser setup failed — playwright CLI not found' });
      return;
    }
  }

  await new Promise((resolve) => {
    pwLog(`Spawning: ${process.execPath} [${playwrightCli}, install, chromium]`);

    const proc = spawn(process.execPath, [playwrightCli, 'install', 'chromium'], {
      stdio: 'pipe',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });

    proc.on('error', (err) => {
      pwLog(`Spawn error: ${err.message}`);
    });

    const onData = d => {
      const msg = d.toString().trim();
      if (msg) {
        pwLog(msg);
        mainWindow.webContents.send('playwright-status', { stage: 'installing', message: msg });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('close', (code, signal) => {
      pwLog(`Install process exited — code: ${code} signal: ${signal}`);
      if (browsersPath && fs.existsSync(browsersPath)) {
        pwLog(`cloaked-manager-browsers contents: ${fs.readdirSync(browsersPath).join(', ') || '(empty)'}`);
      } else {
        pwLog(`cloaked-manager-browsers directory does not exist after install`);
      }
      mainWindow.webContents.send('playwright-status', {
        stage: code === 0 ? 'ready' : 'error',
        message: code === 0 ? 'Browser ready!' : `Browser setup failed (exit code ${code})`
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