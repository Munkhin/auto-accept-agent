/**
 * 06_lifecycle.js — Lifecycle API
 *
 * Adapted from background_loop_debug.js lines 352-403.
 * Provides window.__autoAcceptStart/Stop/GetStats/UpdateBannedCommands.
 */

// --- STATE INITIALIZATION ---
if (!window.__autoAcceptState) {
    window.__autoAcceptState = {
        isRunning: false,
        tabNames: [],
        completionStatus: {},
        sessionID: 0,
        currentMode: null,
        isBackgroundMode: false,
        bannedCommands: [],
        _noTabCycles: 0,
        clicks: 0,
        blocked: 0
    };
    log('[FLOW] State initialized (fresh)');
} else {
    log('[FLOW] State already exists (re-injection)');
}

// --- PUBLIC API ---

window.__autoAcceptUpdateBannedCommands = function(bannedList) {
    window.__autoAcceptState.bannedCommands = Array.isArray(bannedList) ? bannedList : [];
    log(`[CONFIG] Banned commands: ${window.__autoAcceptState.bannedCommands.length} patterns`);
};

window.__autoAcceptGetStats = function() {
    const s = window.__autoAcceptState;
    return { clicks: s.clicks || 0, blocked: s.blocked || 0 };
};

window.__autoAcceptSetFocusState = function() {
    // No-op: analytics removed
};

window.__autoAcceptStart = function(config) {
    try {
        const ide = (config.ide || 'cursor').toLowerCase();
        const isBG = config.isBackgroundMode === true;

        if (config.bannedCommands) {
            window.__autoAcceptUpdateBannedCommands(config.bannedCommands);
        }

        const state = window.__autoAcceptState;

        log(`[FLOW] __autoAcceptStart called: ide=${ide}, bg=${isBG}`);

        // Same config → skip
        if (state.isRunning && state.currentMode === ide && state.isBackgroundMode === isBG) {
            log('[FLOW] Already running with same config, skipping');
            return;
        }

        // Dismount overlay when switching AWAY from background mode
        if (state.isBackgroundMode && !isBG) {
            log('[FLOW] Switching from BG -> non-BG: dismounting overlay');
            dismountOverlay();
        }

        // Stop previous session (loop will exit on next iteration)
        if (state.isRunning) {
            log('[FLOW] Stopping previous session...');
            state.isRunning = false;
        }

        state.isRunning = true;
        state.currentMode = ide;
        state.isBackgroundMode = isBG;
        state.sessionID++;
        const sid = state.sessionID;

        if (isBG) {
            log(`[FLOW] Starting BACKGROUND mode (${ide}, sid=${sid})`);
            mountOverlay();

            if (ide === 'cursor') cursorLoop(sid);
            else antigravityLoop(sid);
        } else {
            log(`[FLOW] Starting SIMPLE mode (${ide}, sid=${sid})`);
            (async function staticLoop() {
                while (state.isRunning && state.sessionID === sid) {
                    await performClick(SELECTORS.cursorButtons);
                    await new Promise(r => setTimeout(r, config.pollInterval || 1000));
                }
                log('[FLOW] staticLoop STOPPED');
            })();
        }
    } catch (e) {
        log(`[ERROR] __autoAcceptStart: ${e.message}`);
        console.error('[AutoAccept] Start error:', e);
    }
};

window.__autoAcceptStop = function() {
    log('[FLOW] __autoAcceptStop called');
    window.__autoAcceptState.isRunning = false;
    window.__autoAcceptState._noTabCycles = 0;
    dismountOverlay();
    log('[FLOW] Agent stopped');
};

log('[FLOW] Ready');
