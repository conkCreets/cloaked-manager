const { ipcMain, app } = require('electron');
const { getMainWindow } = require('../shared');

let autoUpdater;

function send(event, payload) {
  const w = getMainWindow();
  if (w) w.webContents.send(event, payload);
}

function initAutoUpdater() {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update',  ()       => send('update-status', { type: 'checking' }));
  autoUpdater.on('update-available',     info     => send('update-status', { type: 'available', version: info.version, releaseNotes: info.releaseNotes }));
  autoUpdater.on('update-not-available', ()       => send('update-status', { type: 'not-available' }));
  autoUpdater.on('download-progress',    progress => send('download-progress', progress));
  autoUpdater.on('update-downloaded',    info     => send('update-status', { type: 'downloaded', version: info.version }));
  autoUpdater.on('error',                err      => send('update-status', { type: 'error', message: err.message }));

  ipcMain.handle('check-for-updates', () => {
    autoUpdater.checkForUpdates().catch(err => send('update-status', { type: 'error', message: err.message }));
    return { ok: true };
  });
  ipcMain.handle('download-update',    () => { autoUpdater.downloadUpdate(); return { ok: true }; });
  ipcMain.on('restart-and-install',    () => autoUpdater.quitAndInstall(true, true));
}

function startUpdateCheck() {
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
  }
}

module.exports = { initAutoUpdater, startUpdateCheck };