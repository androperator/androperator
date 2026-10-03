#!/usr/bin/env node
/**
 * com.android.vending.search-app
 *
 * Searches for a named app in the Google Play Store and navigates to its details page.
 *
 * Usage:
 *   node search_play_store.js <device_id> <query> [operator_package] [package_id]
 *
 * Arguments:
 *   device_id         - ADB device serial
 *   query             - App name to search for (e.g. "VLC")
 *   operator_package  - Androperator Operator package (default: com.androperator.operator.dev)
 *   package_id        - Optional Android package ID for direct entry path (e.g. org.videolan.vlc)
 *
 * Selector notes (discovered via live exploration):
 *   - Play Store has NO resource-ids on interactive elements.
 *   - Search bar (inactive): contentDescEquals "Search Google Play"
 *   - Search input (active): role "textfield" (android.widget.EditText, no resource-id)
 *   - content-desc uses HTML entities (&apos; etc). Always use contentDescContains for
 *     substring matching to avoid encoding issues.
 *   - App entry in results: contentDescContains with the app name substring.
 */

const { execFileSync } = require('child_process');
const path = require('path');
const { writeFileSync } = require('fs');
const { tmpdir } = require('os');

const deviceId = process.argv[2] || process.env.DEVICE_ID;
const rawQuery = process.argv[3] || process.env.QUERY || '';
const query = rawQuery.trim();
const operatorPkg = process.argv[4] || process.env.OPERATOR_PKG || 'com.androperator.operator.dev';
const packageId = process.argv[5] || process.env.PACKAGE_ID || '';

// Use local CLI build from the repo root (supports 'recording' canonical command)
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const LOCAL_CLAW = path.join(REPO_ROOT, 'apps', 'node', 'dist', 'cli', 'index.js');

function runAndroperatorLocal(execution, deviceId, operatorPkg) {
  const tmpFile = path.join(tmpdir(), execution.commandId + '.json');
  writeFileSync(tmpFile, JSON.stringify(execution));

  const args = [LOCAL_CLAW, 'exec', '--execution', tmpFile, '--device', deviceId, '--operator-package', operatorPkg];

  try {
    const output = execFileSync('node', args, { encoding: 'utf-8' });
    const result = JSON.parse(output);
    return { ok: true, result, raw: output };
  } catch (e) {
    let msg = e.message;
    if (e.stderr) msg += '\nSTDERR: ' + Buffer.from(e.stderr).toString();
    if (e.stdout) msg += '\nSTDOUT: ' + Buffer.from(e.stdout).toString();
    return { ok: false, error: msg };
  }
}

const MAX_QUERY_LENGTH = 256;

function findAttribute(line, attrName) {
  const regex = new RegExp(`${attrName}="([^"]*)"`);
  const match = line.match(regex);
  if (!match) return null;
  return match[1] === '' ? null : match[1];
}

if (!deviceId || !query) {
  console.error('Usage: node search_play_store.js <device_id> <query> [operator_package] [package_id]');
  process.exit(1);
}

if (query.length > MAX_QUERY_LENGTH) {
  console.error(`Query too long (max ${MAX_QUERY_LENGTH})`);
  process.exit(1);
}

const commandId = `skill-play-search-${Date.now()}`;

/**
 * Build an in-app search execution payload.
 * Flow: close -> open -> wait -> click Search tab -> click search bar ->
 *       enter text -> wait -> click first suggestion -> wait -> click first result -> snap
 *
 * Why this flow:
 * - Close+reopen ensures a clean state regardless of what was on screen.
 * - The "Search" tab must be clicked before the bar becomes tappable.
 * - contentDescEquals "Search Google Play" targets the inactive search bar.
 * - role: "textfield" targets the active EditText (no resource-id).
 * - contentDescContains "Search for" targets the first suggestion, avoiding HTML entity issues.
 * - contentDescContains with the query targets the first result app entry.
 *
 * Note on submit: true with enter_text - this submits the search immediately.
 * Alternatively, contentDescContains "Search for" can be used to tap the suggestion.
 */
function buildSearchExecution(query) {
  // Escape the query for use in contentDescContains
  const queryLower = query.toLowerCase();

  return {
    commandId,
    taskId: commandId,
    source: 'androperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 120000,
    actions: [
      { id: 'close', type: 'close_app', params: { applicationId: 'com.android.vending' } },
      { id: 'wait-close', type: 'sleep', params: { durationMs: 1500 } },
      { id: 'open', type: 'open_app', params: { applicationId: 'com.android.vending' } },
      { id: 'wait-open', type: 'sleep', params: { durationMs: 4000 } },
      { id: 'click-search-tab', type: 'click', params: { matcher: { textEquals: 'Search' } } },
      { id: 'wait-search-tab', type: 'sleep', params: { durationMs: 1000 } },
      { id: 'click-search-bar', type: 'click', params: { matcher: { contentDescEquals: 'Search Google Play' } } },
      { id: 'wait-bar', type: 'sleep', params: { durationMs: 500 } },
      {
        id: 'enter-query',
        type: 'enter_text',
        params: { matcher: { role: 'textfield' }, text: query, submit: false }
      },
      { id: 'wait-suggest', type: 'sleep', params: { durationMs: 1500 } },
      // Click the "Search for '<query>'" suggestion to execute the search.
      // contentDescContains "Search for" avoids HTML entity encoding issues in content-desc.
      {
        id: 'click-suggestion',
        type: 'click',
        params: { matcher: { contentDescContains: 'Search for' } }
      },
      { id: 'wait-results', type: 'sleep', params: { durationMs: 3000 } },
      // Click the first result that contains the query text in its content-desc.
      // The app entry node has content-desc="<AppName>\n<Developer>\n" (multiline).
      // contentDescContains on a substring of the app name is reliable.
      {
        id: 'click-first-result',
        type: 'click',
        params: { matcher: { contentDescContains: query } }
      },
      { id: 'wait-detail', type: 'sleep', params: { durationMs: 3000 } },
      { id: 'snap', type: 'snapshot_ui' }
    ]
  };
}

/**
 * Try to navigate directly to the app details page via adb market:// deep link.
 * This path requires package_id to be known.
 *
 * Limitation: Androperator's open_app action does not support deep links or URI schemes.
 * The adb am start command is used outside the execution payload for this path.
 *
 * Blocking state: On devices with multiple app stores (e.g. Samsung Galaxy Store),
 * a "Open with" picker appears. This function handles it by clicking "Google Play Store"
 * then confirming with "Just once" if needed.
 */
function buildDirectEntryExecution() {
  return {
    commandId,
    taskId: commandId,
    source: 'androperator-skill',
    expectedFormat: 'android-ui-automator',
    timeoutMs: 30000,
    actions: [
      { id: 'wait-open', type: 'sleep', params: { durationMs: 3000 } },
      // Handle "Open with" picker if present (multi-store devices).
      // wait_for_node would be cleaner but we use a snap+conditional approach here.
      { id: 'snap-picker', type: 'snapshot_ui' },
      // Attempt to click "Google Play Store" in picker; will fail gracefully if not present.
      {
        id: 'click-play-store',
        type: 'click',
        params: { matcher: { textEquals: 'Google Play Store' } }
      },
      { id: 'wait-after-picker', type: 'sleep', params: { durationMs: 2000 } },
      { id: 'snap', type: 'snapshot_ui' }
    ]
  };
}

// --- Main execution ---

let result;
let usedDirectPath = false;

if (packageId) {
  // Attempt direct entry path via market:// deep link (outside Androperator execution).
  // This fires the intent synchronously; the Play Store opens asynchronously.
  try {
    execFileSync('adb', ['-s', deviceId, 'shell', 'am', 'start',
      '-a', 'android.intent.action.VIEW',
      '-d', `market://details?id=${packageId}`
    ], { stdio: 'pipe' });
    usedDirectPath = true;
  } catch (e) {
    console.error(`Direct entry adb command failed: ${e.message}`);
    console.error('Falling back to in-app search path.');
  }
}

if (usedDirectPath) {
  const execution = buildDirectEntryExecution();
  const { ok, result: r, error } = runAndroperatorLocal(execution, deviceId, operatorPkg);
  if (!ok) {
    console.error(`Direct entry execution failed: ${error}`);
    console.error('Falling back to in-app search path.');
    usedDirectPath = false;
  } else {
    result = r;
  }
}

if (!usedDirectPath) {
  const execution = buildSearchExecution(query);
  const { ok, result: r, error } = runAndroperatorLocal(execution, deviceId, operatorPkg);
  if (!ok) {
    console.error(`Search execution failed: ${error}`);
    process.exit(2);
  }
  result = r;
}

// --- Parse results ---

const stepResults = (result && result.envelope && result.envelope.stepResults) || [];
const snapStep = stepResults.find(s => s.id === 'snap');
const snapText = snapStep && snapStep.data ? snapStep.data.text : null;

if (!snapText) {
  console.error('No snapshot returned. The app details page may not have loaded.');
  process.exit(3);
}

// Check for login/account picker state
const allText = snapText;
if (allText.includes('Sign in') || allText.includes('Choose an account')) {
  console.error('Login required. Please sign in to Google Play on the device.');
  process.exit(4);
}

// Extract app details from snapshot
const lines = snapText.split('\n');
let appName = '';
let developer = '';
let installState = 'unknown';
let rating = '';
let downloads = '';

lines.forEach(line => {
  const t = findAttribute(line, 'text') || '';
  const c = findAttribute(line, 'content-desc') || '';

  // App name: typically appears as text at the top of the details page
  if (!appName && t && t.toLowerCase().includes(query.toLowerCase()) && t.length < 80) {
    appName = t;
  }

  // Developer name: appears after the app name
  if (appName && !developer && t && !t.includes('$') && t.length < 50 &&
      !['Uninstall', 'Install', 'Open', 'Update'].includes(t)) {
    developer = t;
  }

  // Install state signals
  if (c === 'Install' || t === 'Install') installState = 'not-installed';
  if (c === 'Open' || t === 'Open') installState = 'installed';
  if (t === 'Update') installState = 'update-available';

  // Rating
  if (c.includes('Average rating')) rating = c;

  // Downloads
  if (c.includes('Downloaded') && c.includes('times')) downloads = c;
});

const pathUsed = usedDirectPath ? 'direct (market://)' : 'in-app search';

console.log(`SUCCESS - App details page loaded`);
console.log(`Path used: ${pathUsed}`);
console.log(`App: ${appName || '(not extracted)'}`);
console.log(`Developer: ${developer || '(not extracted)'}`);
console.log(`Install state: ${installState}`);
if (rating) console.log(`Rating: ${rating}`);
if (downloads) console.log(`Downloads: ${downloads}`);
console.log(`\nSnapshot saved to device. Ready for com.android.vending.install-app.`);
