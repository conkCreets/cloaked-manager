const Store = require('electron-store');

const store = new Store({ encryptionKey: 'cloaked-manager-local-key' });
let _mainWindow = null;

function setMainWindow(win) { _mainWindow = win; }
function getMainWindow() { return _mainWindow; }

function dbg(panel, level, message) {
  if (!_mainWindow || _mainWindow.isDestroyed()) return;
  _mainWindow.webContents.send('debug-log', { panel, level, message, ts: new Date().toISOString() });
}

module.exports = { store, dbg, setMainWindow, getMainWindow };