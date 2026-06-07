# Changelog

## v2.2.0
- EXE packaging via electron-builder (NSIS installer, `npm run build`)
- Auto-update via GitHub releases using electron-updater (`npm run publish`)
- GitHub token field in Settings for private-repo update authentication
- Update modal with version number, release notes, download progress bar, and Restart Now button
- Silent auto-check for updates on launch (packaged builds only)
- First-launch Playwright Chromium install: shows overlay if browser not yet set up

## v2.1.3
- Fixed login URL to `https://my.cloaked.com/auth/login` (correct Cloaked login page)
- Updated creator and Open Cloaked button URLs to match

## v2.1.2
- Increased Alpine.js render wait from 1.5s to 5s for login form

## v2.1.1
- Login helper now waits for any input before looking for username field
- Added fallback input detection if name="username" not found
- Logs all inputs on page to debug console for diagnostics

## v2.1.0
- Added Debug Console drawer with Sync, Creator, and SMS/Codes tabs
- Rich logging with INFO/SUCCESS/WARN/ERROR/VERBOSE levels
- Error badge on Debug Console button when issues occur
- Copy and Clear buttons per panel

## v2.0.6
- Added Sync Log panel to Dashboard
- All sync messages and errors displayed with timestamps and color coding
- Copy Log and Clear buttons

## v2.0.5
- Updated phone number placeholder to 10-digit format (no country code)

## v2.0.4
- Fixed login selector to use exact Cloaked DOM attributes (name="username")
- Uses Enter key to submit each login step

## v2.0.3
- Rewrote login flow to handle two-step identifier/password screens
- Human-like character-by-character typing with randomized delays
- Updated phone number placeholder format

## v2.0.2
- Added email/phone login support
- Updated credentials field label

## v2.0.1
- Fixed Cloaked URL (app.cloaked.app → your.cloaked.app)

## v2.0.0
- Full rebuild: stripped SMTP/email forwarding
- Added Codes list page with CSV export
- Separate alias creator process with bell-curve delays (1-3 min)
- Single form + CSV bulk import with preview
- Pause/resume/stop controls
- Auto-mapping at creation time
- Browser mode: Headless / Hidden / Visible
- Fingerprint hardening

## v1.4.0
- Browser mode toggle (headless/hidden/visible)
- Fingerprint hardening (navigator.webdriver, plugins, languages)

## v1.3.0
- Batched FIFO send queue with batch size + delay sliders
- Live progress bar during sends

## v1.2.0
- Gmail/SMTP email forwarding + send queue

## v1.1.0
- Debug screenshot viewer page

## v1.0.0
- Initial build: scraper, aliases, 2FA codes, mappings, debug screenshots, browser mode
