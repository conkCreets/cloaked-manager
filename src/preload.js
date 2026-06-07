const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cloakedAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close:    () => ipcRenderer.send('window-close'),

  // Credentials
  saveCredentials: (c) => ipcRenderer.invoke('save-credentials', c),
  loadCredentials: ()  => ipcRenderer.invoke('load-credentials'),

  // Mappings
  saveMappings: (m) => ipcRenderer.invoke('save-mappings', m),
  loadMappings: ()  => ipcRenderer.invoke('load-mappings'),

  // Scraper
  syncCloaked: (creds) => ipcRenderer.invoke('sync-cloaked', creds),
  onSyncStatus: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('sync-status', h);
    return () => ipcRenderer.removeListener('sync-status', h);
  },

  // Creator
  creatorStart:  (opts) => ipcRenderer.invoke('creator-start', opts),
  creatorPause:  ()     => ipcRenderer.invoke('creator-pause'),
  creatorResume: ()     => ipcRenderer.invoke('creator-resume'),
  creatorStop:   ()     => ipcRenderer.invoke('creator-stop'),
  onCreatorEvent: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('creator-event', h);
    return () => ipcRenderer.removeListener('creator-event', h);
  },

  // Browser mode
  saveBrowserMode: (m) => ipcRenderer.invoke('save-browser-mode', m),
  loadBrowserMode: ()  => ipcRenderer.invoke('load-browser-mode'),

  // Debug screenshots
  saveDebugSettings:     (s) => ipcRenderer.invoke('save-debug-settings', s),
  loadDebugSettings:     ()  => ipcRenderer.invoke('load-debug-settings'),
  openDebugFolder:       ()  => ipcRenderer.invoke('open-debug-folder'),
  listDebugScreenshots:  ()  => ipcRenderer.invoke('list-debug-screenshots'),
  deleteDebugScreenshot: (p) => ipcRenderer.invoke('delete-debug-screenshot', p),
  clearDebugScreenshots: ()  => ipcRenderer.invoke('clear-debug-screenshots'),

  // Debug console log stream
  onDebugLog: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('debug-log', h);
    return () => ipcRenderer.removeListener('debug-log', h);
  },

  // External
  openExternal: (url) => ipcRenderer.send('open-external', url)
});
