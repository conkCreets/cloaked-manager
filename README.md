# Cloaked Manager

A personal desktop app (Windows) that logs into your Cloaked account, fetches your aliases, detects 2FA codes, and maps them to your online accounts.

---

## Requirements

- **Node.js** v18 or later → https://nodejs.org
- **Git** (optional) or just download this folder as a zip

---

## Setup (one-time)

Open a terminal (Command Prompt or PowerShell) in this folder:

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright's Chromium browser
npx playwright install chromium
```

---

## Running the app

```bash
npm start
```

---

## First-time usage

1. **Open Settings** (left sidebar → Settings)
2. Enter your Cloaked account **email** and **password**, then click **Save Credentials**
3. Click **Start Sync** in the bottom-left — the app will:
   - Launch a headless browser
   - Log into your Cloaked account
   - Scrape your aliases and any recent 2FA codes
4. **Open Mappings** to label each alias (e.g. "Amazon", "Target")
5. Click **Save Mappings**

From now on, just hit **Start Sync** whenever you need a fresh set of codes. They'll appear on the Dashboard and 2FA Codes pages with a one-click copy button.

---

## Features

| Feature | Description |
|---|---|
| **Auto Login** | Logs into app.cloaked.app using saved credentials |
| **Alias Fetching** | Pulls all your email and phone aliases |
| **2FA Code Detection** | Detects OTP/verification codes in your inbox |
| **Account Mappings** | Label each alias with its retailer/account |
| **One-Click Copy** | Click any code or alias to copy it instantly |
| **Local Storage** | All data stored locally on your machine (encrypted) |

---

## Notes & Troubleshooting

- **Login fails?** Cloaked may require 2FA on the login itself. If so, watch for the headless browser to request a code — a future version can prompt you mid-sync.
- **No aliases found?** Cloaked's UI may have changed. Open `src/main.js` and look for the `page.evaluate()` block — the CSS selectors can be updated to match Cloaked's current DOM.
- **Playwright not found?** Run `npx playwright install chromium` again.

---

## Privacy

- Credentials are stored locally in an encrypted file via `electron-store`
- Nothing is sent to any external server — all automation happens on your machine
- For personal use only
