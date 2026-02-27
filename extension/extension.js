const vscode = require('vscode');
const path = require('path');
const https = require('https');

// Lazy load SettingsPanel to avoid blocking activation
let SettingsPanel = null;
function getSettingsPanel() {
    if (!SettingsPanel) {
        try {
            SettingsPanel = require('./settings-panel').SettingsPanel;
        } catch (e) {
            console.error('Failed to load SettingsPanel:', e);
        }
    }
    return SettingsPanel;
}

// states

const GLOBAL_STATE_KEY = 'auto-accept-enabled-global';
const PRO_STATE_KEY = 'auto-accept-isPro';
const FREQ_STATE_KEY = 'auto-accept-frequency';
const BANNED_COMMANDS_KEY = 'auto-accept-banned-commands';
const ROI_STATS_KEY = 'auto-accept-roi-stats'; // For ROI notification
const SECONDS_PER_CLICK = 5; // Conservative estimate: 5 seconds saved per auto-accept
const LICENSE_API = 'https://auto-accept-backend.onrender.com/api';
let isEnabled = false;
let isPro = false;
let isLockedOut = false; // Local tracking
let pollFrequency = 1000; // Default polling interval
let bannedCommands = []; // List of command patterns to block

// Background Mode state
let backgroundModeEnabled = false;
const BACKGROUND_DONT_SHOW_KEY = 'auto-accept-background-dont-show';
const BACKGROUND_MODE_KEY = 'auto-accept-background-mode';
const FIRST_INSTALL_KEY = 'auto-accept-first-install-complete';
const SUMMARY_API_URL = `${LICENSE_API}/session-summary`;
const SESSION_LOG_LIMIT = 300;
const LOG_LINE_MAX_CHARS = 500;
const VISIBLE_TEXT_MAX_CHARS = 12000;
const SUMMARY_REQUEST_TIMEOUT_MS = 8000;

let pollTimer;
let statsCollectionTimer; // For periodic stats collection
let statusBarItem;
let statusSettingsItem;
let statusBackgroundItem; // New: Background Mode toggle
let outputChannel;
let currentIDE = 'unknown'; // 'cursor' | 'antigravity'
let globalContext;
let summaryRequestInFlight = false;
let currentSession = null;
let sessionLogBuffer = [];
let sessionCounter = 0;
let lastSessionSummary = null;

// Button clicking is handled entirely via CDP injection (auto_accept.js)
// No IDE command execution — all accept actions are DOM button clicks

// Handlers (used by both IDEs now)
let cdpHandler;
let relauncher;

function log(message) {
    try {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        const logLine = `[${timestamp}] ${message}`;
        console.log(logLine);
        if (outputChannel) {
            outputChannel.appendLine(logLine);
        }
        appendSessionLog(logLine);
    } catch (e) {
        console.error('Logging failed:', e);
    }
}

function detectIDE() {
    const appName = vscode.env.appName || '';
    if (appName.toLowerCase().includes('cursor')) return 'Cursor';
    if (appName.toLowerCase().includes('antigravity')) return 'Antigravity';
    return 'Code'; // only supporting these 3 for now
}

function appendSessionLog(line) {
    if (!line) return;
    sessionLogBuffer.push(String(line).slice(0, LOG_LINE_MAX_CHARS));
    if (sessionLogBuffer.length > SESSION_LOG_LIMIT) {
        sessionLogBuffer = sessionLogBuffer.slice(sessionLogBuffer.length - SESSION_LOG_LIMIT);
    }
}

function ensureSessionStarted() {
    if (currentSession && !currentSession.endedAt) return;
    sessionCounter += 1;
    lastSessionSummary = null;
    currentSession = {
        sessionId: `session-${Date.now()}-${sessionCounter}`,
        startedAt: new Date().toISOString(),
        endedAt: null,
        ide: String(currentIDE || 'unknown').toLowerCase(),
        backgroundMode: !!backgroundModeEnabled
    };
    sessionLogBuffer = [];
    appendSessionLog(`[SESSION] Started ${currentSession.sessionId}`);
}

function markSessionEnded() {
    if (!currentSession || currentSession.endedAt) return;
    currentSession.endedAt = new Date().toISOString();
    appendSessionLog(`[SESSION] Ended ${currentSession.sessionId}`);
}

function truncateText(text, maxChars) {
    const value = String(text || '');
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}...`;
}

function redactSensitiveText(text) {
    return String(text || '')
        .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_KEY]')
        .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/ig, '$1[REDACTED_TOKEN]')
        .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]');
}

function normalizeStats(stats) {
    const base = stats || {};
    return {
        clicks: Number(base.clicks || 0),
        blocked: Number(base.blocked || 0),
        fileEdits: Number(base.fileEdits || 0),
        terminalCommands: Number(base.terminalCommands || 0)
    };
}

function hasMeaningfulSummaryInput(stats, logs, visibleConversationText) {
    const s = normalizeStats(stats);
    const totalStats = s.clicks + s.blocked + s.fileEdits + s.terminalCommands;
    return totalStats > 0 || logs.length > 0 || String(visibleConversationText || '').trim().length > 0;
}

function buildSummaryPayload(context, stats, visibleConversationText) {
    const safeLogs = sessionLogBuffer.map(line => truncateText(redactSensitiveText(line), LOG_LINE_MAX_CHARS));
    const sessionMeta = {
        sessionId: currentSession?.sessionId || `session-${Date.now()}-ad-hoc`,
        startedAt: currentSession?.startedAt || null,
        endedAt: currentSession?.endedAt || null,
        generatedAt: new Date().toISOString(),
        ide: currentSession?.ide || String(currentIDE || 'unknown').toLowerCase(),
        backgroundMode: currentSession?.backgroundMode ?? !!backgroundModeEnabled
    };

    return {
        userId: context.globalState.get('auto-accept-userId') || null,
        sessionMeta,
        stats: normalizeStats(stats),
        logs: safeLogs,
        visibleConversationText: truncateText(redactSensitiveText(visibleConversationText), VISIBLE_TEXT_MAX_CHARS)
    };
}

async function postJson(url, payload, timeoutMs = SUMMARY_REQUEST_TIMEOUT_MS) {
    const body = JSON.stringify(payload || {});
    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            },
            timeout: timeoutMs
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`Summary API failed with status ${res.statusCode}`));
                }
                try {
                    resolve(data ? JSON.parse(data) : {});
                } catch (e) {
                    reject(new Error('Summary API returned invalid JSON.'));
                }
            });
        });

        req.on('timeout', () => req.destroy(new Error('Summary API timed out.')));
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function generateSessionSummary(context, options = {}) {
    if (!context) throw new Error('Extension context unavailable.');

    if (summaryRequestInFlight) {
        if (!options.silent) {
            vscode.window.showInformationMessage('Auto Accept: Summary generation is already in progress.');
        }
        return lastSessionSummary;
    }

    const targetPageId = options.pageId || null;
    summaryRequestInFlight = true;
    if (targetPageId && cdpHandler) {
        await cdpHandler.pushSummaryResult(targetPageId, { status: 'loading' });
    }

    try {
        const stats = cdpHandler ? await cdpHandler.getSessionSummary() : normalizeStats();
        const visibleConversationText = cdpHandler
            ? await cdpHandler.getVisibleConversationText(targetPageId, VISIBLE_TEXT_MAX_CHARS)
            : '';
        const payload = buildSummaryPayload(context, stats, visibleConversationText);

        if (!hasMeaningfulSummaryInput(payload.stats, payload.logs, payload.visibleConversationText)) {
            throw new Error('Not enough session data to summarize yet.');
        }

        const response = await postJson(SUMMARY_API_URL, payload, SUMMARY_REQUEST_TIMEOUT_MS);
        const summaryText = String(response.summary || '').trim();
        if (!summaryText) {
            throw new Error('Summary API returned empty summary text.');
        }

        lastSessionSummary = {
            summary: summaryText,
            generatedAt: new Date().toISOString(),
            sessionId: payload.sessionMeta.sessionId
        };
        log(`[Summary] Generated for ${lastSessionSummary.sessionId}`);

        if (cdpHandler) {
            await cdpHandler.pushSummaryResult(targetPageId, {
                status: 'success',
                summary: summaryText,
                generatedAt: lastSessionSummary.generatedAt
            });
        }

        if (!options.silent) {
            vscode.window.showInformationMessage('Auto Accept: Session summary ready.');
        }

        return lastSessionSummary;
    } catch (e) {
        log(`[Summary] Failed: ${e.message}`);
        if (cdpHandler) {
            await cdpHandler.pushSummaryResult(targetPageId, {
                status: 'error',
                error: 'Failed to generate summary. Please try again.'
            });
        }
        if (!options.silent) {
            vscode.window.showErrorMessage(`Auto Accept: ${e.message}`);
        }
        throw e;
    } finally {
        summaryRequestInFlight = false;
    }
}

async function checkForSummaryRequests(context) {
    if (!isEnabled || backgroundModeEnabled || !cdpHandler || summaryRequestInFlight) return;

    try {
        const requests = await cdpHandler.consumeSummaryRequests();
        if (!Array.isArray(requests) || requests.length === 0) return;

        const primary = requests[0];
        const result = await generateSessionSummary(context, {
            pageId: primary.id,
            source: 'overlay',
            silent: true
        });

        for (let i = 1; i < requests.length; i++) {
            await cdpHandler.pushSummaryResult(requests[i].id, {
                status: 'success',
                summary: result?.summary || '',
                generatedAt: result?.generatedAt || new Date().toISOString()
            });
        }
    } catch (e) {
        log(`[Summary] Request processing error: ${e.message}`);
    }
}

async function activate(context) {
    globalContext = context;
    console.log('Auto Accept Extension: Activator called.');

    // CRITICAL: Create status bar items FIRST before anything else
    try {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.command = 'auto-accept.toggle';
        statusBarItem.text = '$(sync~spin) Auto Accept: Loading...';
        statusBarItem.tooltip = 'Auto Accept is initializing...';
        context.subscriptions.push(statusBarItem);
        statusBarItem.show();

        statusSettingsItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
        statusSettingsItem.command = 'auto-accept.openSettings';
        statusSettingsItem.text = '$(gear)';
        statusSettingsItem.tooltip = 'Auto Accept Settings & Pro Features';
        context.subscriptions.push(statusSettingsItem);
        statusSettingsItem.show();

        // Background Mode status bar item
        statusBackgroundItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        statusBackgroundItem.command = 'auto-accept.toggleBackground';
        statusBackgroundItem.text = '$(globe) Background: OFF';
        statusBackgroundItem.tooltip = 'Background Mode (Pro) - Works on all chats';
        context.subscriptions.push(statusBackgroundItem);
        // Don't show by default - only when Auto Accept is ON

        console.log('Auto Accept: Status bar items created and shown.');
    } catch (sbError) {
        console.error('CRITICAL: Failed to create status bar items:', sbError);
    }

    try {
        // 1. Initialize State
        isEnabled = context.globalState.get(GLOBAL_STATE_KEY, false);
        isPro = context.globalState.get(PRO_STATE_KEY, false);

        // Load frequency
        pollFrequency = context.globalState.get(FREQ_STATE_KEY, 1000);

        // Load background mode state
        backgroundModeEnabled = context.globalState.get(BACKGROUND_MODE_KEY, false);

        // Load banned commands list (default: common dangerous patterns)
        const defaultBannedCommands = [
            'rm -rf /',
            'rm -rf ~',
            'rm -rf *',
            'format c:',
            'del /f /s /q',
            'rmdir /s /q',
            ':(){:|:&};:',  // fork bomb
            'dd if=',
            'mkfs.',
            '> /dev/sda',
            'chmod -R 777 /'
        ];
        bannedCommands = context.globalState.get(BANNED_COMMANDS_KEY, defaultBannedCommands);


        // 1.5 Verify License Background Check
        verifyLicense(context).then(isValid => {
            // null = network/parse error — preserve current Pro status
            if (isValid === null) {
                log('License re-verification: Network error, preserving current Pro status');
                return;
            }
            if (isPro !== isValid) {
                isPro = isValid;
                context.globalState.update(PRO_STATE_KEY, isValid);
                log(`License re-verification: Updated Pro status to ${isValid}`);

                if (cdpHandler && cdpHandler.setProStatus) {
                    cdpHandler.setProStatus(isValid);
                }

                updateStatusBar();
            }
        });

        currentIDE = detectIDE();

        // 2. Create Output Channel
        outputChannel = vscode.window.createOutputChannel('Auto Accept');
        context.subscriptions.push(outputChannel);

        log(`Auto Accept: Activating...`);
        log(`Auto Accept: Detected environment: ${currentIDE.toUpperCase()}`);

        // Setup Focus Listener - Push state to browser (authoritative source)
        vscode.window.onDidChangeWindowState(async (e) => {
            // Always push focus state to browser - this is the authoritative source
            if (cdpHandler && cdpHandler.setFocusState) {
                await cdpHandler.setFocusState(e.focused);
            }

            // When user returns and auto-accept is running, check for away actions
            if (e.focused && isEnabled) {
                log(`[Away] Window focus detected by VS Code API. Checking for away actions...`);
                // Wait a tiny bit for CDP to settle after focus state is pushed
                setTimeout(() => checkForAwayActions(context), 500);
            }
        });

        // 3. Initialize Handlers (Lazy Load) - Both IDEs use CDP now
        try {
            const { CDPHandler } = require('./main_scripts/cdp-handler');
            const { Relauncher } = require('./main_scripts/relauncher');

            cdpHandler = new CDPHandler(log);
            relauncher = new Relauncher(log);
            log(`CDP handlers initialized for ${currentIDE}.`);
        } catch (err) {
            log(`Failed to initialize CDP handlers: ${err.message}`);
            vscode.window.showErrorMessage(`Auto Accept Error: ${err.message}`);
        }

        // 4. Update Status Bar (already created at start)
        updateStatusBar();
        log('Status bar updated with current state.');

        // 5. Register Commands
        context.subscriptions.push(
            vscode.commands.registerCommand('auto-accept.toggle', () => handleToggle(context)),
            vscode.commands.registerCommand('auto-accept.relaunch', () => handleRelaunch()),
            vscode.commands.registerCommand('auto-accept.updateFrequency', (freq) => handleFrequencyUpdate(context, freq)),
            vscode.commands.registerCommand('auto-accept.toggleBackground', () => handleBackgroundToggle(context)),
            vscode.commands.registerCommand('auto-accept.updateBannedCommands', (commands) => handleBannedCommandsUpdate(context, commands)),
            vscode.commands.registerCommand('auto-accept.getBannedCommands', () => bannedCommands),
            vscode.commands.registerCommand('auto-accept.getROIStats', async () => {
                const stats = await loadROIStats(context);
                const timeSavedSeconds = stats.clicksThisWeek * SECONDS_PER_CLICK;
                const timeSavedMinutes = Math.round(timeSavedSeconds / 60);
                return {
                    ...stats,
                    timeSavedMinutes,
                    timeSavedFormatted: timeSavedMinutes >= 60
                        ? `${(timeSavedMinutes / 60).toFixed(1)} hours`
                        : `${timeSavedMinutes} minutes`
                };
            }),
            vscode.commands.registerCommand('auto-accept.openSettings', () => {
                const panel = getSettingsPanel();
                if (panel) {
                    panel.createOrShow(context.extensionUri, context);
                } else {
                    vscode.window.showErrorMessage('Failed to load Settings Panel.');
                }
            }),
            vscode.commands.registerCommand('auto-accept.generateSessionSummary', () =>
                generateSessionSummary(context, { source: 'command', silent: false })),
            vscode.commands.registerCommand('auto-accept.getLastSessionSummary', () => lastSessionSummary),
            vscode.commands.registerCommand('auto-accept.activatePro', () => handleProActivation(context)),
            vscode.commands.registerCommand('auto-accept.onPaid', () => handlePaidActivation(context))
        );

        // 6. Register URI Handler for deep links (e.g., from Stripe success page)
        const uriHandler = {
            handleUri(uri) {
                log(`URI Handler received: ${uri.toString()}`);
                if (uri.path === '/activate' || uri.path === 'activate') {
                    log('Activation URI detected - verifying pro status...');
                    handleProActivation(context);
                }
            }
        };
        context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));
        log('URI Handler registered for activation deep links.');

        // 7. Check environment and start if enabled
        try {
            await checkEnvironmentAndStart();
        } catch (err) {
            log(`Error in environment check: ${err.message}`);
        }

        // 8. Show first-time user guide if new install
        showFirstTimeGuide(context);

        log('Auto Accept: Activation complete');
    } catch (error) {
        console.error('ACTIVATION CRITICAL FAILURE:', error);
        log(`ACTIVATION CRITICAL FAILURE: ${error.message}`);
        vscode.window.showErrorMessage(`Auto Accept Extension failed to activate: ${error.message}`);
    }
}

async function ensureCDPOrPrompt(showPrompt = false) {
    if (!cdpHandler) return false;

    log('Checking for active CDP session...');
    const cdpAvailable = await cdpHandler.isCDPAvailable();
    log(`Environment check: CDP Available = ${cdpAvailable}`);

    if (cdpAvailable) {
        log('CDP is active and available.');
        return true;
    } else {
        log('CDP not found on target ports (9000 +/- 3).');
        if (showPrompt && relauncher) {
            log('Initiating CDP setup flow...');
            await relauncher.ensureCDPAndRelaunch();
        }
        return false;
    }
}

async function checkEnvironmentAndStart() {
    if (isEnabled) {
        if (!isPro) {
            log('Auto Accept enabled but license not verified. Disabling until licensed.');
            isEnabled = false;
            await globalContext.globalState.update(GLOBAL_STATE_KEY, false);
            updateStatusBar();
            return;
        }
        log('Initializing Auto Accept environment...');

        // CDP is required for button clicking (webview DOM access)
        const cdpAvailable = await ensureCDPOrPrompt(true);
        if (!cdpAvailable) {
            log('CDP not available. Prompting user for setup.');
            return;
        }

        // Start polling (commands + CDP)
        await startPolling();
        startStatsCollection(globalContext);
    }
    updateStatusBar();
}

async function handleToggle(context) {
    log('=== handleToggle CALLED ===');
    log(`  Previous isEnabled: ${isEnabled}`);

    try {
        if (!isEnabled && !isPro) {
            vscode.window.showInformationMessage(
                'Auto Accept requires an active license.',
                'Purchase License'
            ).then(choice => {
                if (choice === 'Purchase License') {
                    vscode.commands.executeCommand('auto-accept.openSettings');
                }
            });
            return;
        }

        isEnabled = !isEnabled;
        log(`  New isEnabled: ${isEnabled}`);

        // Update state and UI IMMEDIATELY (non-blocking)
        await context.globalState.update(GLOBAL_STATE_KEY, isEnabled);
        log(`  GlobalState updated`);

        log('  Calling updateStatusBar...');
        updateStatusBar();

        // Do CDP operations — required for all IDEs
        if (isEnabled) {
            log('Auto Accept: Enabled');

            // CDP is required for button clicking (webview DOM access)
            const cdpAvailable = await ensureCDPOrPrompt(true);
            if (!cdpAvailable) {
                log('CDP not available. Prompting user for setup.');
                // Keep enabled state so it auto-starts after relaunch
                return;
            }

            startPolling();
            startStatsCollection(context);
            incrementSessionCount(context);
        } else {
            log('Auto Accept: Disabled');
            markSessionEnded();

            // Fire-and-forget: Show session summary notification (non-blocking)
            if (cdpHandler) {
                cdpHandler.getSessionSummary()
                    .then(summary => showSessionSummaryNotification(context, summary))
                    .catch(() => { });
            }

            // Fire-and-forget: collect stats and stop in background
            collectAndSaveStats(context).catch(() => { });
            stopPolling().catch(() => { });
        }

        log('=== handleToggle COMPLETE ===');
    } catch (e) {
        log(`Error toggling: ${e.message}`);
        log(`Error stack: ${e.stack}`);
    }
}

async function handlePaidActivation(context) {
    if (!isPro) {
        log('handlePaidActivation called but Pro not verified.');
        return;
    }
    log('Paid activation confirmed. Starting CDP setup...');
    await ensureCDPOrPrompt(true);
    if (isEnabled) {
        await startPolling();
    }
}

async function handleRelaunch() {
    if (!relauncher) {
        vscode.window.showErrorMessage('Relauncher not initialized.');
        return;
    }
    if (!isPro) {
        vscode.window.showInformationMessage(
            'Auto Accept requires an active license.',
            'Purchase License'
        ).then(choice => {
            if (choice === 'Purchase License') {
                vscode.commands.executeCommand('auto-accept.openSettings');
            }
        });
        return;
    }

    log('Initiating CDP Setup flow...');
    await relauncher.ensureCDPAndRelaunch();
}

async function handleFrequencyUpdate(context, freq) {
    pollFrequency = freq;
    await context.globalState.update(FREQ_STATE_KEY, freq);
    log(`Poll frequency updated to: ${freq}ms`);
    if (isEnabled) {
        await syncSessions();
    }
}

async function handleBannedCommandsUpdate(context, commands) {
    if (!isPro) {
        log('Banned commands customization requires an active license');
        return;
    }
    bannedCommands = Array.isArray(commands) ? commands : [];
    await context.globalState.update(BANNED_COMMANDS_KEY, bannedCommands);
    log(`Banned commands updated: ${bannedCommands.length} patterns`);
    if (bannedCommands.length > 0) {
        log(`Banned patterns: ${bannedCommands.slice(0, 5).join(', ')}${bannedCommands.length > 5 ? '...' : ''}`);
    }
    if (isEnabled) {
        await syncSessions();
    }
}

async function handleBackgroundToggle(context) {
    log('Background toggle clicked');

    if (!isPro) {
        vscode.window.showInformationMessage(
            'Auto Accept requires an active license.',
            'Purchase License'
        ).then(choice => {
            if (choice === 'Purchase License') {
                vscode.commands.executeCommand('auto-accept.openSettings');
            }
        });
        return;
    }

    // Pro tier: CDP required for Background Mode
    if (!backgroundModeEnabled) {
        const cdpAvailable = cdpHandler ? await cdpHandler.isCDPAvailable() : false;
        if (!cdpAvailable && relauncher) {
            log('Background Mode requires CDP. Prompting for setup...');
            await relauncher.ensureCDPAndRelaunch();
            return;
        }
    }

    // Check if we should show first-time dialog
    const dontShowAgain = context.globalState.get(BACKGROUND_DONT_SHOW_KEY, false);

    if (!dontShowAgain && !backgroundModeEnabled) {
        // First-time enabling: Show confirmation dialog
        const choice = await vscode.window.showInformationMessage(
            'Turn on Background Mode?\n\n' +
            'This lets Auto Accept work on all your open chats at once. ' +
            'It will switch between tabs to click Accept for you.\n\n' +
            'You might see tabs change quickly while it works.',
            { modal: true },
            'Enable',
            "Don't Show Again & Enable",
            'Cancel'
        );

        if (choice === 'Cancel' || !choice) {
            log('Background mode cancelled by user');
            return;
        }

        if (choice === "Don't Show Again & Enable") {
            await context.globalState.update(BACKGROUND_DONT_SHOW_KEY, true);
            log('Background mode: Dont show again set');
        }

        // Enable it
        backgroundModeEnabled = true;
        await context.globalState.update(BACKGROUND_MODE_KEY, true);
        log('Background mode enabled');
    } else {
        // Simple toggle
        backgroundModeEnabled = !backgroundModeEnabled;
        await context.globalState.update(BACKGROUND_MODE_KEY, backgroundModeEnabled);
        log(`Background mode toggled: ${backgroundModeEnabled}`);

        // If background mode is being turned OFF, stop background loops immediately
        if (!backgroundModeEnabled && cdpHandler && isEnabled) {
            log('Background mode OFF: Stopping background loops...');
            // Stop current session and restart in simple mode
            await cdpHandler.stop();
            await syncSessions();
            log('Background mode OFF: Restarted in simple mode');
        } else if (backgroundModeEnabled && cdpHandler && isEnabled) {
            // Background mode turned ON - restart in background mode
            log('Background mode ON: Switching to background mode...');
            await syncSessions();
        }

        // Hide overlay if being disabled (redundant safety - cdp-handler also does this)
        if (!backgroundModeEnabled && cdpHandler) {
            cdpHandler.hideBackgroundOverlay().catch(() => { });
        }
    }

    // Update UI immediately
    updateStatusBar();
}



async function syncSessions() {
    if (cdpHandler && !isLockedOut) {
        log(`CDP: Syncing sessions (Mode: ${backgroundModeEnabled ? 'Background' : 'Simple'})...`);
        try {
            await cdpHandler.start({
                isPro,
                isBackgroundMode: backgroundModeEnabled,
                pollInterval: pollFrequency,
                ide: currentIDE,
                bannedCommands: bannedCommands
            });
        } catch (err) {
            log(`CDP: Sync error: ${err.message}`);
        }
    }
}

async function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    ensureSessionStarted();
    log('Auto Accept: Monitoring session...');

    // Initial CDP sync — injects auto_accept.js which handles all button clicking
    await syncSessions();

    // Periodic polling: instance locking + CDP keep-alive + summary requests
    pollTimer = setInterval(async () => {
        if (!isEnabled) return;

        // Check for instance locking - only the first extension instance should control CDP
        const lockKey = `${currentIDE.toLowerCase()}-instance-lock`;
        const activeInstance = globalContext.globalState.get(lockKey);
        const myId = globalContext.extension.id;

        if (activeInstance && activeInstance !== myId) {
            const lastPing = globalContext.globalState.get(`${lockKey}-ping`);
            if (lastPing && (Date.now() - lastPing) < 15000) {
                if (!isLockedOut) {
                    log(`CDP Control: Locked by another instance (${activeInstance}). Standby mode.`);
                    isLockedOut = true;
                    updateStatusBar();
                }
                return;
            }
        }

        // We are the leader or lock is dead
        globalContext.globalState.update(lockKey, myId);
        globalContext.globalState.update(`${lockKey}-ping`, Date.now());

        if (isLockedOut) {
            log('CDP Control: Lock acquired. Resuming control.');
            isLockedOut = false;
            updateStatusBar();
        }

        await syncSessions();
        checkForSummaryRequests(globalContext).catch(() => { });
    }, 5000);
}

async function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    if (statsCollectionTimer) {
        clearInterval(statsCollectionTimer);
        statsCollectionTimer = null;
    }
    if (cdpHandler) await cdpHandler.stop();
    markSessionEnded();
    log('Auto Accept: Polling stopped');
}

// --- ROI Stats Collection ---

function getWeekStart() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday
    const diff = now.getDate() - dayOfWeek;
    const weekStart = new Date(now.setDate(diff));
    weekStart.setHours(0, 0, 0, 0);
    return weekStart.getTime();
}

async function loadROIStats(context) {
    const defaultStats = {
        weekStart: getWeekStart(),
        clicksThisWeek: 0,
        blockedThisWeek: 0,
        sessionsThisWeek: 0
    };

    let stats = context.globalState.get(ROI_STATS_KEY, defaultStats);

    // Check if we need to reset for a new week
    const currentWeekStart = getWeekStart();
    if (stats.weekStart !== currentWeekStart) {
        log(`ROI Stats: New week detected. Showing summary and resetting.`);

        // Show weekly summary notification if there were meaningful stats
        if (stats.clicksThisWeek > 0) {
            await showWeeklySummaryNotification(context, stats);
        }

        // Reset for new week
        stats = { ...defaultStats, weekStart: currentWeekStart };
        await context.globalState.update(ROI_STATS_KEY, stats);
    }

    return stats;
}

async function showWeeklySummaryNotification(context, lastWeekStats) {
    const timeSavedSeconds = lastWeekStats.clicksThisWeek * SECONDS_PER_CLICK;
    const timeSavedMinutes = Math.round(timeSavedSeconds / 60);

    let timeStr;
    if (timeSavedMinutes >= 60) {
        timeStr = `${(timeSavedMinutes / 60).toFixed(1)} hours`;
    } else {
        timeStr = `${timeSavedMinutes} minutes`;
    }

    const message = `📊 Last week, Auto Accept saved you ${timeStr} by auto-clicking ${lastWeekStats.clicksThisWeek} buttons!`;

    let detail = '';
    if (lastWeekStats.sessionsThisWeek > 0) {
        detail += `Recovered ${lastWeekStats.sessionsThisWeek} stuck sessions. `;
    }
    if (lastWeekStats.blockedThisWeek > 0) {
        detail += `Blocked ${lastWeekStats.blockedThisWeek} dangerous commands.`;
    }

    const choice = await vscode.window.showInformationMessage(
        message,
        { detail: detail.trim() || undefined },
        'View Details'
    );

    if (choice === 'View Details') {
        const panel = getSettingsPanel();
        if (panel) {
            panel.createOrShow(context.extensionUri, context);
        }
    }
}

// --- SESSION SUMMARY NOTIFICATION ---
// Called when user finishes a session (e.g., leaves conversation view)
async function showSessionSummaryNotification(context, summary) {
    log(`[Notification] showSessionSummaryNotification called with: ${JSON.stringify(summary)}`);
    if (!summary || summary.clicks === 0) {
        log(`[Notification] Session summary skipped: no clicks`);
        return;
    }
    log(`[Notification] Showing session summary for ${summary.clicks} clicks`);

    const lines = [
        `✅ This session:`,
        `• ${summary.clicks} actions auto-accepted`,
        `• ${summary.terminalCommands} terminal commands`,
        `• ${summary.fileEdits} file edits`,
        `• ${summary.blocked} interruptions blocked`
    ];

    if (summary.estimatedTimeSaved) {
        lines.push(`\n⏱ Estimated time saved: ~${summary.estimatedTimeSaved} minutes`);
    }

    const message = lines.join('\n');

    vscode.window.showInformationMessage(
        `🤖 Auto Accept: ${summary.clicks} actions handled this session`,
        { detail: message },
        'View Stats'
    ).then(choice => {
        if (choice === 'View Stats') {
            const panel = getSettingsPanel();
            if (panel) panel.createOrShow(context.extensionUri, context);
        }
    });
}

// --- "AWAY" ACTIONS NOTIFICATION ---
// Called when user returns after window was minimized/unfocused
async function showAwayActionsNotification(context, actionsCount) {
    log(`[Notification] showAwayActionsNotification called with: ${actionsCount}`);
    if (!actionsCount || actionsCount === 0) {
        log(`[Notification] Away actions skipped: count is 0 or undefined`);
        return;
    }
    log(`[Notification] Showing away actions notification for ${actionsCount} actions`);

    const message = `🚀 Auto Accept handled ${actionsCount} action${actionsCount > 1 ? 's' : ''} while you were away.`;
    const detail = `Agents stayed autonomous while you focused elsewhere.`;

    vscode.window.showInformationMessage(
        message,
        { detail },
        'View Dashboard'
    ).then(choice => {
        if (choice === 'View Dashboard') {
            const panel = getSettingsPanel();
            if (panel) panel.createOrShow(context.extensionUri, context);
        }
    });
}

// --- AWAY MODE POLLING ---
// Check for "away actions" when user returns (called periodically)
let lastAwayCheck = Date.now();
async function checkForAwayActions(context) {
    log(`[Away] checkForAwayActions called. cdpHandler=${!!cdpHandler}, isEnabled=${isEnabled}`);
    if (!cdpHandler || !isEnabled) {
        log(`[Away] Skipping check: cdpHandler=${!!cdpHandler}, isEnabled=${isEnabled}`);
        return;
    }

    try {
        log(`[Away] Calling cdpHandler.getAwayActions()...`);
        const awayActions = await cdpHandler.getAwayActions();
        log(`[Away] Got awayActions: ${awayActions}`);
        if (awayActions > 0) {
            log(`[Away] Detected ${awayActions} actions while user was away. Showing notification...`);
            await showAwayActionsNotification(context, awayActions);
        } else {
            log(`[Away] No away actions to report`);
        }
    } catch (e) {
        log(`[Away] Error checking away actions: ${e.message}`);
    }
}

async function collectAndSaveStats(context) {
    if (!cdpHandler) return;

    try {
        // Get stats from browser and reset them
        const browserStats = await cdpHandler.resetStats();

        if (browserStats.clicks > 0 || browserStats.blocked > 0) {
            const currentStats = await loadROIStats(context);
            currentStats.clicksThisWeek += browserStats.clicks;
            currentStats.blockedThisWeek += browserStats.blocked;

            await context.globalState.update(ROI_STATS_KEY, currentStats);
            log(`ROI Stats collected: +${browserStats.clicks} clicks, +${browserStats.blocked} blocked (Total: ${currentStats.clicksThisWeek} clicks, ${currentStats.blockedThisWeek} blocked)`);
        }
    } catch (e) {
        // Silently fail - stats collection should not interrupt normal operation
    }
}

async function incrementSessionCount(context) {
    const stats = await loadROIStats(context);
    stats.sessionsThisWeek++;
    await context.globalState.update(ROI_STATS_KEY, stats);
    log(`ROI Stats: Session count incremented to ${stats.sessionsThisWeek}`);
}

function startStatsCollection(context) {
    if (statsCollectionTimer) clearInterval(statsCollectionTimer);

    // Collect stats every 30 seconds and check for away actions
    statsCollectionTimer = setInterval(() => {
        if (isEnabled) {
            collectAndSaveStats(context);
            checkForAwayActions(context); // Check if user returned from away
        }
    }, 30000);

    log('ROI Stats: Collection started (every 30s)');
}


function updateStatusBar() {
    if (!statusBarItem) return;

    if (isEnabled) {
        let statusText = 'ON';
        let tooltip = `Auto Accept is running.`;
        let bgColor = undefined;
        let icon = '$(check)';

        const cdpConnected = cdpHandler && cdpHandler.getConnectionCount() > 0;

        if (cdpConnected) {
            tooltip += ' (CDP Connected)';
        }

        if (isLockedOut) {
            statusText = 'PAUSED (Multi-window)';
            bgColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            icon = '$(sync~spin)';
        }

        statusBarItem.text = `${icon} Auto Accept: ${statusText}`;
        statusBarItem.tooltip = tooltip;
        statusBarItem.backgroundColor = bgColor;

        // Show Background Mode toggle when Auto Accept is ON
        if (statusBackgroundItem) {
            if (backgroundModeEnabled) {
                statusBackgroundItem.text = '$(sync~spin) Background: ON';
                statusBackgroundItem.tooltip = 'Background Mode is on. Click to turn off.';
                statusBackgroundItem.backgroundColor = undefined;
            } else {
                statusBackgroundItem.text = '$(globe) Background: OFF';
                statusBackgroundItem.tooltip = 'Click to turn on Background Mode (works on all your chats).';
                statusBackgroundItem.backgroundColor = undefined;
            }
            statusBackgroundItem.show();
        }

    } else {
        statusBarItem.text = '$(circle-slash) Auto Accept: OFF';
        statusBarItem.tooltip = 'Click to enable Auto Accept.';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

        // Hide Background Mode toggle when Auto Accept is OFF
        if (statusBackgroundItem) {
            statusBackgroundItem.hide();
        }
    }
}

async function verifyLicense(context, retries = 3) {
    const userId = context.globalState.get('auto-accept-userId');
    if (!userId) return false;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await new Promise((resolve, reject) => {
                const req = https.get(`${LICENSE_API}/check-license?userId=${userId}`, { timeout: 5000 }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            resolve(json.isPro === true);
                        } catch (e) {
                            reject(new Error('Invalid JSON'));
                        }
                    });
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            });
            // Cache verification timestamp on success
            await context.globalState.update('auto-accept-last-verified', Date.now());
            return result;
        } catch (e) {
            log(`License verification attempt ${attempt}/${retries} failed: ${e.message}`);
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1000 * attempt)); // backoff: 1s, 2s, 3s
            }
        }
    }
    // All retries failed — check if we verified recently (within 24h)
    const lastVerified = context.globalState.get('auto-accept-last-verified', 0);
    if (Date.now() - lastVerified < 24 * 60 * 60 * 1000) {
        log('License verification: Network error, but verified within 24h. Preserving status.');
        return null; // preserve current status
    }
    log('License verification: Network error and stale cache. Returning null.');
    return null;
}

// Handle Pro activation (called from URI handler or command)
async function handleProActivation(context) {
    log('Pro Activation: Starting verification process...');

    // Show progress notification
    vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Auto Accept: Verifying Pro status...',
            cancellable: false
        },
        async (progress) => {
            progress.report({ increment: 30 });

            // Give webhook a moment to process (Stripe webhooks can have slight delay)
            await new Promise(resolve => setTimeout(resolve, 1500));
            progress.report({ increment: 30 });

            // Verify license
            const isProNow = await verifyLicense(context);
            progress.report({ increment: 40 });

            if (isProNow) {
                // Update state
                isPro = true;
                await context.globalState.update(PRO_STATE_KEY, true);

                // Update CDP handler if running
                if (cdpHandler && cdpHandler.setProStatus) {
                    cdpHandler.setProStatus(true);
                }

                // Update poll frequency to pro default
                pollFrequency = context.globalState.get(FREQ_STATE_KEY, 1000);

                // Sync sessions with new pro status
                if (isEnabled) {
                    await syncSessions();
                }

                // Update UI
                updateStatusBar();

                await handlePaidActivation(context);

                log('Pro Activation: SUCCESS - User is now Pro!');
                vscode.window.showInformationMessage(
                    '🎉 Pro Activated! Thank you for your support. All Pro features are now unlocked.',
                    'Open Dashboard'
                ).then(choice => {
                    if (choice === 'Open Dashboard') {
                        const panel = getSettingsPanel();
                        if (panel) panel.createOrShow(context.extensionUri, context);
                    }
                });
            } else {
                log('Pro Activation: License not found yet. Starting background polling...');
                // Start background polling in case webhook is delayed
                startProPolling(context);
            }
        }
    );
}

// Background polling for delayed webhook scenarios
let proPollingTimer = null;
let proPollingAttempts = 0;
const MAX_PRO_POLLING_ATTEMPTS = 24; // 2 minutes (5s intervals)

function startProPolling(context) {
    if (proPollingTimer) {
        clearInterval(proPollingTimer);
    }

    proPollingAttempts = 0;
    log('Pro Polling: Starting background verification (checking every 5s for up to 2 minutes)...');

    vscode.window.showInformationMessage(
        'Payment received! Verifying your Pro status... This may take a moment.'
    );

    proPollingTimer = setInterval(async () => {
        const isProNow = await verifyLicense(context);
        if (isProNow === null) {
            log('Pro Polling: Network error — not counting attempt, will retry...');
            return; // Don't burn attempt slots on transient network failures
        }

        proPollingAttempts++;
        log(`Pro Polling: Attempt ${proPollingAttempts}/${MAX_PRO_POLLING_ATTEMPTS}`);

        if (proPollingAttempts > MAX_PRO_POLLING_ATTEMPTS) {
            clearInterval(proPollingTimer);
            proPollingTimer = null;
            log('Pro Polling: Max attempts reached. User should check manually.');
            vscode.window.showWarningMessage(
                'Pro verification is taking longer than expected. Open Settings and click "I already paid" to retry.',
                'Open Settings'
            ).then(choice => {
                if (choice === 'Open Settings') {
                    const panel = getSettingsPanel();
                    if (panel) panel.createOrShow(context.extensionUri, context);
                }
            });
            return;
        }

        if (isProNow) {
            clearInterval(proPollingTimer);
            proPollingTimer = null;

            isPro = true;
            await context.globalState.update(PRO_STATE_KEY, true);

            if (cdpHandler && cdpHandler.setProStatus) {
                cdpHandler.setProStatus(true);
            }

            pollFrequency = context.globalState.get(FREQ_STATE_KEY, 1000);

            if (isEnabled) {
                await syncSessions();
            }

            updateStatusBar();
            await handlePaidActivation(context);

            log('Pro Polling: SUCCESS - Pro status confirmed!');
            vscode.window.showInformationMessage(
                '🎉 Pro Activated! Thank you for your support. All Pro features are now unlocked.',
                'Open Dashboard'
            ).then(choice => {
                if (choice === 'Open Dashboard') {
                    const panel = getSettingsPanel();
                    if (panel) panel.createOrShow(context.extensionUri, context);
                }
            });
        }
    }, 5000);
}

async function showFirstTimeGuide(context) {
    const hasCompletedSetup = context.globalState.get(FIRST_INSTALL_KEY, false);
    if (hasCompletedSetup) return;

    // Mark immediately to prevent showing again on re-activation
    await context.globalState.update(FIRST_INSTALL_KEY, true);

    log('First install detected. Showing user guide...');

    // Step 1: Welcome + feature overview
    const welcomeChoice = await vscode.window.showInformationMessage(
        'Welcome to Auto Accept! Let\'s get you set up in 2 quick steps.',
        { modal: true },
        'Get Started',
        'Skip Setup'
    );

    if (welcomeChoice === 'Skip Setup') return;

    // Step 2: CDP Setup
    const cdpAvailable = await ensureCDPOrPrompt(false);
    if (!cdpAvailable) {
        log('FTUE: CDP not available, prompting setup...');
        if (relauncher) {
            await relauncher.ensureCDPAndRelaunch();
        }
        // After setup panel is shown, payment prompt will come when they toggle on
        return;
    }

    // Step 3: Payment (only if not already pro)
    if (!isPro) {
        log('FTUE: CDP ready but no license. Showing payment prompt...');
        const panel = getSettingsPanel();
        if (panel) {
            panel.createOrShow(context.extensionUri, context, 'prompt');
        }
        return;
    }

    // Already paid + CDP ready = show quick feature guide
    await showFeatureGuide(context);
}

async function showFeatureGuide(context) {
    const guide = [
        '📋 Quick Guide:\n\n' +
        '• Click "Auto Accept: OFF" in the status bar to toggle ON\n' +
        '• Click the ⚙️ icon for settings (polling speed, banned commands)\n' +
        '• Click "Background: OFF" to enable multi-tab mode\n\n' +
        'Auto Accept clicks accept/run/retry buttons for you automatically.\n' +
        'Dangerous commands (rm -rf, format, etc.) are blocked by default.'
    ];

    const choice = await vscode.window.showInformationMessage(
        guide[0],
        { modal: true },
        'Open Settings',
        'Got it'
    );

    if (choice === 'Open Settings') {
        const panel = getSettingsPanel();
        if (panel) panel.createOrShow(context.extensionUri, context);
    }
}

function deactivate() {
    stopPolling();
    markSessionEnded();
    if (cdpHandler) {
        cdpHandler.stop();
    }
}

module.exports = { activate, deactivate };
