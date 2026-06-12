const { ipcMain, app } = require('electron');
const path = require('path');
const fs   = require('fs');
const { store, dbg, getMainWindow } = require('../shared');
const { launchBrowser }                          = require('../scraper/browser');
const { checkAndRestoreSession, enableAdvancedMode } = require('../scraper/scrape');

async function humanType(locator, text) {
  await locator.click();
  for (const char of text) {
    await locator.pressSequentially(char, { delay: Math.floor(Math.random() * 120) + 60 });
  }
}

function bellCurveDelay() {
  const u1 = Math.random(), u2 = Math.random();
  const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const ms = Math.round((z * 300 + 1800) * 1000);
  return Math.max(1500000, Math.min(2100000, ms));
}

const creatorState = { running: false, paused: false, stopped: false, browser: null };

function sendCreatorEvent(type, payload) {
  const w = getMainWindow();
  if (w) w.webContents.send('creator-event', { type, ...payload });
}

ipcMain.handle('creator-start', async (_e, { tasks, email, password }) => {
  if (creatorState.running) return { ok: false, error: 'Already running' };
  creatorState.running = true;
  creatorState.paused  = false;
  creatorState.stopped = false;
  runCreator(tasks, email, password).catch(err => {
    sendCreatorEvent('error', { message: err.message });
    dbg('creator', 'error', `Unhandled creator error: ${err.message}`);
    creatorState.running = false;
  });
  return { ok: true };
});

ipcMain.handle('creator-pause',  () => { creatorState.paused  = true;  dbg('creator', 'warning', 'Paused by user');          return { ok: true }; });
ipcMain.handle('creator-resume', () => { creatorState.paused  = false; dbg('creator', 'info',    'Resumed by user');         return { ok: true }; });
ipcMain.handle('creator-stop',   () => { creatorState.stopped = true; creatorState.paused = false; dbg('creator', 'warning', 'Stop requested by user'); return { ok: true }; });

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function runDelay(taskId, ms, label) {
  const delaySec = Math.round(ms / 1000);
  sendCreatorEvent('waiting', { id: taskId, delayMs: ms, delaySec, label });
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (creatorState.stopped) break;
    while (creatorState.paused && !creatorState.stopped) await new Promise(r => setTimeout(r, 500));
    await new Promise(r => setTimeout(r, 1000));
    const remaining = Math.max(0, Math.round((ms - (Date.now() - start)) / 1000));
    sendCreatorEvent('countdown', { id: taskId, remaining });
  }
}

async function runCreator(tasks, email, password) {
  let browser;
  try {
    const mode = store.get('browserMode', 'headless');
    dbg('creator', 'info', `=== CREATOR STARTED === ${tasks.length} task(s) | mode: ${mode}`);
    sendCreatorEvent('status', { message: 'Launching creator browser…' });

    const sp = path.join(app.getPath('userData'), 'session-state.json');
    const hasSession = fs.existsSync(sp);
    const { browser: b, context } = await launchBrowser(mode, 'creator', hasSession ? sp : null);
    browser = b;
    creatorState.browser = browser;
    const page = await context.newPage();

    sendCreatorEvent('status', { message: hasSession ? 'Checking session…' : 'Logging in…' });
    await checkAndRestoreSession(page, context, email, password, sp, 'creator', hasSession);
    dbg('creator', 'success', hasSession ? 'Session restored' : 'Login complete');

    sendCreatorEvent('status', { message: 'Enabling Advanced Mode…' });
    await enableAdvancedMode(page, 'creator');
    dbg('creator', 'success', 'Advanced Mode enabled');

    sendCreatorEvent('status', { message: 'Navigating to identities…' });
    await page.goto('https://my.cloaked.com/identities', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);
    dbg('creator', 'success', 'Identities page loaded');
    sendCreatorEvent('status', { message: 'Starting alias creation…' });

    // Detect 429 rate limit on phone generation endpoint
    let rateLimited = false;
    page.on('response', res => {
      if (res.status() === 429 && res.url().includes('/phone/')) {
        rateLimited = true;
        dbg('creator', 'error', `Rate limited by Cloaked (429) on ${res.url()}`);
      }
    });

    let tasksSinceBreak = 0;
    let nextBreakAt = randInt(5, 10);

    for (let i = 0; i < tasks.length; i++) {
      if (creatorState.stopped) { sendCreatorEvent('stopped', { message: 'Stopped by user.' }); break; }
      while (creatorState.paused && !creatorState.stopped) await new Promise(r => setTimeout(r, 500));
      if (creatorState.stopped) { sendCreatorEvent('stopped', { message: 'Stopped by user.' }); break; }

      const task = tasks[i];
      dbg('creator', 'info', `--- Task ${i + 1}/${tasks.length}: "${task.username}" ---`);
      sendCreatorEvent('task-start', { id: task.id, message: `Creating alias for ${task.username}…` });

      try {
        const pause = (min, max) => page.waitForTimeout(randInt(min, max));

        // Step 1: click "New identity" button
        dbg('creator', 'info', 'Clicking "New identity" button…');
        await page.locator('button.base-button--secondary-fill.navigation-left-panel__actions-button').click();
        await pause(1000, 2000);

        // Step 2: type account name into the search/add input
        const nameInput = page.locator('[aria-id="SearchOrAddInput"]');
        await nameInput.waitFor({ state: 'visible', timeout: 15000 });
        await pause(500, 1000);
        await humanType(nameInput, task.username);
        dbg('creator', 'success', `Typed identity name: "${task.username}"`);
        await pause(1500, 2500);

        // Step 3: click the suggestion that appears
        const suggestion = page.locator('li.section-list__item--active');
        await suggestion.waitFor({ state: 'visible', timeout: 20000 });
        await pause(800, 1500);
        await suggestion.click();
        dbg('creator', 'success', 'Clicked create suggestion — identity created');

        // Step 4: wait for the detail panel to confirm creation
        await page.locator('[aria-id="CloakNicknameInput"]').waitFor({ state: 'visible', timeout: 20000 });
        await pause(1000, 2000);
        dbg('creator', 'success', 'Detail panel open');

        // Step 5: fill credentials (email goes into Username field; Email field left blank)
        const fieldDelay = () => pause(600, 1400);
        if (task.email) {
          await humanType(page.locator('[aria-id="AddUsernameInput"]'), task.email);
          dbg('creator', 'info', `Filled username with email: ${task.email}`);
          await fieldDelay();
        }
        if (task.password) {
          await humanType(page.locator('[aria-id="AddPasswordInput"]'), task.password);
          dbg('creator', 'info', 'Filled password');
          await fieldDelay();
        }

        // Step 6: hover phone row to reveal Generate button, then click it
        dbg('creator', 'info', 'Generating phone number…');
        await pause(800, 1500);
        await page.locator('[aria-id="AddPhoneInput"]').hover();
        await pause(800, 1500);
        await page.locator('[aria-id="CloakedDetailPhoneRow"] [aria-id="GenerateButton"]').click();

        // Wait for phone value, but bail early if rate limited
        await page.waitForFunction(
          () => (document.querySelector('[aria-id="AddPhoneInput"]')?.value || '').length > 0,
          { timeout: 20000 }
        ).catch(() => {});

        if (rateLimited) throw new Error('RATE_LIMITED');

        await pause(1000, 2000);
        const aliasValue = await page.locator('[aria-id="AddPhoneInput"]').inputValue();
        dbg('creator', 'success', `Generated phone: ${aliasValue}`);

        if (!aliasValue) throw new Error('Generate button clicked but no phone value appeared');

        // Close the sidebar so "New Identity" is ready for the next task
        await pause(800, 1500);
        await page.locator('[aria-id="SidebarCloseButton"]').click();
        await pause(1000, 2000);
        dbg('creator', 'info', 'Sidebar closed');

        // Save mapping
        const mappings = store.get('mappings', {});
        const newId = `created-${Date.now()}`;
        mappings[newId] = { label: task.username, forwardTo: '' };
        store.set('mappings', mappings);
        dbg('creator', 'success', `Mapping saved: "${task.username}" → ${aliasValue}`);

        sendCreatorEvent('task-done', { id: task.id, aliasValue, username: task.username, email: task.email, password: task.password, mappingId: newId });

      } catch (err) {
        if (err.message === 'RATE_LIMITED') {
          dbg('creator', 'error', 'Rate limited by Cloaked — stopping creator');
          sendCreatorEvent('task-failed', { id: task.id, error: 'Rate limited by Cloaked — try again later' });
          sendCreatorEvent('rate-limited', { message: 'Cloaked has rate limited phone number generation. Try again in ~21 hours.' });
          break;
        }
        dbg('creator', 'error', `Task failed: ${err.message}`);
        dbg('creator', 'verbose', err.stack || '(no stack)');
        sendCreatorEvent('task-failed', { id: task.id, error: err.message });
      }

      tasksSinceBreak++;

      if (i < tasks.length - 1 && !creatorState.stopped) {
        const delay = bellCurveDelay();
        dbg('creator', 'info', `Waiting ${Math.round(delay / 60000)}min before next task (bell-curve delay)`);
        await runDelay(task.id, delay, 'Waiting before next alias…');

        if (!creatorState.stopped && tasksSinceBreak >= nextBreakAt) {
          const breakMs  = randInt(5, 10) * 60 * 1000;
          const breakMin = Math.round(breakMs / 60000);
          dbg('creator', 'info', `Taking a ${breakMin}min break after ${tasksSinceBreak} tasks`);
          await runDelay(task.id, breakMs, `Taking a ${breakMin}min break…`);
          tasksSinceBreak = 0;
          nextBreakAt = randInt(5, 10);
        }
      }
    }

    await browser.close();
    creatorState.browser = null;
    creatorState.running = false;
    dbg('creator', 'success', '=== CREATOR COMPLETE ===');
    sendCreatorEvent('complete', { message: 'All tasks finished.' });

  } catch (err) {
    dbg('creator', 'error', `=== CREATOR FAILED === ${err.message}`);
    dbg('creator', 'verbose', err.stack || '(no stack)');
    if (browser) await browser.close().catch(() => {});
    creatorState.browser = null;
    creatorState.running = false;
    sendCreatorEvent('error', { message: err.message });
  }
}