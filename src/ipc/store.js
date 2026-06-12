const { ipcMain, app, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const { store } = require('../shared');

ipcMain.handle('get-version', () => app.getVersion());

// Credentials
ipcMain.handle('save-credentials', (_e, creds) => { store.set('credentials', creds); return { ok: true }; });
ipcMain.handle('load-credentials', ()           => store.get('credentials', null));

// Session
ipcMain.handle('clear-session', () => {
  const sessionPath = path.join(app.getPath('userData'), 'session-state.json');
  try { fs.unlinkSync(sessionPath); } catch (_) {}
  return { ok: true };
});

// Aliases
ipcMain.handle('save-aliases', (_e, a) => { store.set('aliases', a); return { ok: true }; });
ipcMain.handle('load-aliases', ()       => store.get('aliases', []));

// Codes
ipcMain.handle('save-codes',              (_e, c) => { store.set('codes', c); return { ok: true }; });
ipcMain.handle('load-codes',              ()       => store.get('codes', []));
ipcMain.handle('clear-code-history',      ()       => { store.delete('seenCodeFingerprints'); return { ok: true }; });
ipcMain.handle('remove-code-fingerprints', (_e, ids) => {
  const seen = store.get('seenCodeFingerprints', []);
  store.set('seenCodeFingerprints', seen.filter(f => !ids.includes(f)));
  return { ok: true };
});

// Mappings
ipcMain.handle('save-mappings', (_e, m) => { store.set('mappings', m); return { ok: true }; });
ipcMain.handle('load-mappings', ()       => store.get('mappings', {}));

// Creator queue
ipcMain.handle('save-queue', (_e, q) => { store.set('creatorQueue', q); return { ok: true }; });
ipcMain.handle('load-queue', ()       => store.get('creatorQueue', []));

// Browser mode
ipcMain.handle('save-browser-mode', (_e, mode) => { store.set('browserMode', mode); return { ok: true }; });
ipcMain.handle('load-browser-mode', ()          => store.get('browserMode', 'headless'));

// Debug settings
ipcMain.handle('save-debug-settings', (_e, s) => { store.set('debugSettings', s); return { ok: true }; });
ipcMain.handle('load-debug-settings', ()       => store.get('debugSettings', { enabled: false }));

ipcMain.handle('open-debug-folder', () => {
  const dir = path.join(app.getPath('userData'), 'debug-screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return { ok: true };
});

ipcMain.handle('list-debug-screenshots', () => {
  const dir = path.join(app.getPath('userData'), 'debug-screenshots');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.png'))
    .map(f => {
      const full = path.join(dir, f), stat = fs.statSync(full);
      return { name: f, path: full, size: stat.size, mtime: stat.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
});

ipcMain.handle('delete-debug-screenshot', (_e, p) => {
  try { fs.unlinkSync(p); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('clear-debug-screenshots', () => {
  const dir = path.join(app.getPath('userData'), 'debug-screenshots');
  if (!fs.existsSync(dir)) return { ok: true };
  fs.readdirSync(dir).filter(f => f.endsWith('.png')).forEach(f => fs.unlinkSync(path.join(dir, f)));
  return { ok: true };
});

// External
ipcMain.on('open-external', (_e, url) => shell.openExternal(url));