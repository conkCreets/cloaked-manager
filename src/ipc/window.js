const { ipcMain } = require('electron');
const { getMainWindow } = require('../shared');

ipcMain.on('window-minimize', () => getMainWindow().minimize());
ipcMain.on('window-maximize', () => {
  const w = getMainWindow();
  w.isMaximized() ? w.unmaximize() : w.maximize();
});
ipcMain.on('window-close', () => getMainWindow().close());