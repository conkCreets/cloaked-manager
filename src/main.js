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
  // Try package subpath exports first (works in dev mode).
  // In packaged apps the exports field blocks './cli', so fall back to deriving
  // the path from the main entry and converting the asar virtual path to the
  // real unpacked path that a subprocess can actually read.
  for (const pkg of ['playwright', 'playwright-core']) {
    try { playwrightCli = require.resolve(`${pkg}/cli`); break; } catch (_) {}
  }
  if (!playwrightCli) {
    for (const pkg of ['playwright', 'playwright-core']) {
      try {
        const pkgRoot = path.dirname(require.resolve(pkg));
        for (const rel of ['cli.js', path.join('lib', 'cli', 'cli.js')]) {
          const candidate = path.join(pkgRoot, rel).replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1');
          if (fs.existsSync(candidate)) { playwrightCli = candidate; break; }
        }
      } catch (_) {}
      if (playwrightCli) break;
    }
  }
  if (!playwrightCli) {
    pwLog('ERROR: Could not find playwright CLI in any expected location');
    mainWindow.webContents.send('playwright-status', { stage: 'error', message: 'Browser setup failed — playwright CLI not found' });
    return;
  }
  pwLog(`playwright CLI resolved to: ${playwrightCli}`);

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