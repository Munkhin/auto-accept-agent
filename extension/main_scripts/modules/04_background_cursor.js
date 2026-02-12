/**
 * 04_background_cursor.js — Cursor IDE Background Loop
 *
 * From background_loop_debug.js lines 199-254.
 * Clicks accept buttons, discovers tabs, rotates through them.
 */

async function cursorLoop(sid) {
    log('[FLOW] cursorLoop STARTED');
    let index = 0;
    let cycle = 0;
    const state = window.__autoAcceptState;
    state._noTabCycles = 0;

    while (state.isRunning && state.sessionID === sid) {
        cycle++;

        const clicked = await performClick(SELECTORS.cursorButtons);
        if (clicked > 0) log(`[LOOP ${cycle}] Clicked ${clicked} buttons`);

        await new Promise(r => setTimeout(r, 800));

        let tabs = [];
        for (const selector of SELECTORS.cursorTabs) {
            tabs = queryAll(selector);
            if (tabs.length > 0) break;
        }

        if (tabs.length === 0) {
            state._noTabCycles++;
            if (state._noTabCycles <= 3 || state._noTabCycles % 10 === 0) {
                log(`[LOOP ${cycle}] No tabs found (x${state._noTabCycles})`);
            }
        } else {
            if (state._noTabCycles > 0) log(`[LOOP ${cycle}] Found ${tabs.length} tabs (recovered after ${state._noTabCycles} empty cycles)`);
            state._noTabCycles = 0;
        }

        updateTabNames(tabs);

        if (tabs.length > 0) {
            const targetTab = tabs[index % tabs.length];
            const tabLabel = targetTab.getAttribute('aria-label') || targetTab.textContent?.trim() || '?';
            log(`[LOOP ${cycle}] Rotating to tab "${stripTimeSuffix(tabLabel)}"`);
            targetTab.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
            index++;
        }

        await new Promise(r => setTimeout(r, 3000));
    }
    log('[FLOW] cursorLoop STOPPED');
}
