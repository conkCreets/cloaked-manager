const { dbg, store } = require('../shared');
const { loginToCloaked } = require('./login');

async function checkAndRestoreSession(page, context, email, password, sessionPath, panel, hasSession) {
  if (hasSession) {
    await page.goto('https://my.cloaked.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    dbg(panel, 'info', `Settled URL: ${page.url()}`);
    if (page.url().includes('/auth/')) {
      dbg(panel, 'warning', 'Session expired — logging in again…');
      await loginToCloaked(page, email, password, panel);
      await context.storageState({ path: sessionPath });
      dbg(panel, 'success', 'New session saved');
    } else {
      dbg(panel, 'success', `Session valid — login skipped (URL: ${page.url()})`);
    }
  } else {
    await loginToCloaked(page, email, password, panel);
    await context.storageState({ path: sessionPath });
    dbg(panel, 'success', 'Session saved — future syncs will skip login');
  }
}

async function enableAdvancedMode(page, panel) {
  dbg(panel, 'info', 'Waiting for Advanced Mode toggle to appear…');
  const toggle = page.locator('button.navigation-advanced-toggle__button-toggle[aria-label="Toggle"]');
  try {
    await toggle.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    throw new Error('Advanced features toggle not found after 15s — cannot scrape without Advanced Mode');
  }
  const isOn = await toggle.getAttribute('aria-pressed').catch(() => 'false');
  if (isOn === 'true') {
    dbg(panel, 'info', 'Advanced Mode already on');
    return;
  }
  await toggle.click();
  dbg(panel, 'success', 'Advanced toggle clicked — waiting for confirmation modal…');
  const tryBtn = page.locator('button.advanced-mode-modal__button.base-button--primary-fill');
  try {
    await tryBtn.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    throw new Error('"Try Advanced" button not found — cannot continue without Advanced Mode');
  }
  await tryBtn.click();
  dbg(panel, 'success', '"Try Advanced" confirmed');
  await page.waitForTimeout(1500);
}

async function scrapeAliases(page, panel) {
  dbg(panel, 'info', 'Looking for All Identities tab…');
  try {
    const tab = page.locator([
      'a:has-text("All Identities")',
      'button:has-text("All Identities")',
      '[role="tab"]:has-text("All Identities")',
    ].join(', ')).first();
    if (await tab.count() > 0) {
      await tab.click();
      dbg(panel, 'success', 'Clicked All Identities tab');
      await page.waitForTimeout(2000);
    } else {
      dbg(panel, 'warning', 'All Identities tab not found — scraping current view');
    }
  } catch (e) {
    dbg(panel, 'warning', `All Identities navigation error: ${e.message}`);
  }

  await page.waitForTimeout(1500);
  dbg(panel, 'info', 'Scraping identity cards…');

  const { aliases, aliasDebug } = await page.evaluate(() => {
    const results = [];
    const debug   = [];
    const seen    = new Set();
    const cloakedEmailRe = /[a-zA-Z0-9._%+\-]+@cloaked\.(app|com)/i;
    const items = [...document.querySelectorAll('div.item[id]')]
      .filter(el => /^\d+$/.test(el.id));
    debug.push(`Found ${items.length} identity card(s)`);
    items.forEach((item, i) => {
      const h1     = item.querySelector('h1.base-text--callout-emphasized');
      const cardEl = item.querySelector('[aria-label^="Cloak card for "]');
      const name   = h1?.innerText.trim()
        || cardEl?.getAttribute('aria-label').replace('Cloak card for ', '').trim()
        || `Identity ${i + 1}`;
      const phoneEls = [...item.querySelectorAll('div.base-text--footnote-regular')];
      const phone    = phoneEls.map(el => el.innerText.trim()).find(t => t.length > 0) || null;
      const emailMatch = (item.innerText || '').match(cloakedEmailRe);
      const email      = emailMatch ? emailMatch[0].toLowerCase() : null;
      const key = phone || email || name;
      if (phone || email) {
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ id: item.id, name, email, phone });
          debug.push(`[${item.id}] "${name}": phone=${phone||'—'} email=${email||'—'}`);
        } else {
          debug.push(`[${item.id}] "${name}": duplicate (${key}) skipped`);
        }
      } else {
        debug.push(`[${item.id}] "${name}": no phone or email found`);
      }
    });
    return { aliases: results, aliasDebug: debug };
  });

  aliasDebug.forEach(line => dbg(panel, aliases.length > 0 ? 'verbose' : 'warning', line));
  if (aliases.length > 0) {
    dbg(panel, 'success', `Found ${aliases.length} alias(es)`);
    aliases.forEach(a => dbg(panel, 'verbose', `  → ${a.name}: email=${a.email||'—'} phone=${a.phone||'—'}`));
  } else {
    dbg(panel, 'warning', 'No aliases found — selectors may need updating. Enable debug screenshots to inspect the page.');
  }

  return aliases;
}

async function scrapeCodes(page, panel) {
  dbg(panel, 'info', 'Navigating to texts inbox…');
  await page.goto('https://my.cloaked.com/inbox/texts', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('div.inbox-list', { timeout: 15000 });
  await page.waitForTimeout(1000);

  const rawItems = await page.evaluate(() => {
    return [...document.querySelectorAll('button.list-item')].map(item => ({
      name:    item.querySelector('.item-name span')?.innerText.trim()                                         || '',
      message: item.querySelector('.item-title .content span.base-text--callout-emphasized')?.innerText.trim() || '',
      date:    item.querySelector('.item-date span')?.innerText.trim()                                         || '',
    }));
  });

  dbg(panel, 'verbose', `Found ${rawItems.length} inbox item(s)`);

  const seenFingerprints = new Set(store.get('seenCodeFingerprints', []));
  const codes = [];

  for (const item of rawItems) {
    if (/cloaked/i.test(item.name)) {
      dbg(panel, 'verbose', `Skipping automated message from: ${item.name}`);
      continue;
    }
    const codeMatch = item.message.match(/\b\d{6}\b/);
    if (!codeMatch) {
      dbg(panel, 'verbose', `No code in message from ${item.name}: "${item.message.substring(0, 60)}"`);
      continue;
    }
    const fingerprint = `${item.name}||${item.message}`;
    if (!seenFingerprints.has(fingerprint)) {
      codes.push({ id: fingerprint, alias: item.name, code: codeMatch[0], message: item.message, date: item.date, scrapedAt: new Date().toISOString() });
      dbg(panel, 'success', `New code from ${item.name}: ${codeMatch[0]} (${item.date})`);
    } else {
      dbg(panel, 'verbose', `Already seen — ${item.name}: ${codeMatch[0]}`);
    }
  }

  store.set('seenCodeFingerprints', rawItems
    .filter(i => !/cloaked/i.test(i.name))
    .map(i => `${i.name}||${i.message}`)
  );

  dbg(panel, codes.length > 0 ? 'success' : 'warning',
    codes.length > 0 ? `Found ${codes.length} new code(s)` : 'No new codes found');

  return codes;
}

module.exports = { checkAndRestoreSession, enableAdvancedMode, scrapeAliases, scrapeCodes };