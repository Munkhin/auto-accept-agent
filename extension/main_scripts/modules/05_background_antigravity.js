/**
 * 05_background_antigravity.js — Antigravity IDE Background Loop
 *
 * From background_loop_debug.js lines 257-350.
 * Sequence per cycle:
 *   1. Check badges (Good/Bad)
 *   2. If no badge: click accept buttons
 *   3. Wait 800ms
 *   4. Click "+" button (new-conversation-tooltip) to show conversations
 *   5. Poll for tabs (up to 5s)
 *   6. Update tab names (triggers overlay loading)
 *   7. Click next tab in rotation
 *   8. Wait 1500ms
 *   9. Check badges again after tab switch
 *  10. If badge found: mark conversation completed on overlay
 *  11. Wait 3000ms
 */

async function antigravityLoop(sid) {
    log('[FLOW] antigravityLoop STARTED');
    let index = 0;
    let cycle = 0;
    const state = window.__autoAcceptState;
    state._noTabCycles = 0;

    while (state.isRunning && state.sessionID === sid) {
        cycle++;

        // Step 1: Check for completion badges BEFORE clicking
        const feedbackBadges = queryAll(SELECTORS.badgeTag).filter(s => {
            const t = s.textContent.trim();
            return SELECTORS.badgeTexts.includes(t);
        });
        const hasBadge = feedbackBadges.length > 0;

        // Step 2: Click accept buttons if no badge
        if (!hasBadge) {
            const clicked = await performClick(SELECTORS.antigravityButtons);
            if (clicked > 0) log(`[LOOP ${cycle}] Clicked ${clicked} accept buttons`);
        } else {
            log(`[LOOP ${cycle}] Conversation DONE (badge found), skipping clicks`);
        }

        // Step 3: Wait 800ms
        await new Promise(r => setTimeout(r, 800));

        // Step 4: Click tab panel button to show conversations
        const nt = queryAll(SELECTORS.newConversation)[0];
        if (nt) nt.click();

        // Step 5: Poll for tabs with timeout
        let tabsAfter = [];
        const panelWaitStart = Date.now();
        while (Date.now() - panelWaitStart < 5000) {
            await new Promise(r => setTimeout(r, 300));
            tabsAfter = queryAll(SELECTORS.antigravityTabs);
            if (tabsAfter.length > 0) break;
        }

        if (tabsAfter.length === 0) {
            state._noTabCycles++;
            if (state._noTabCycles <= 3 || state._noTabCycles % 10 === 0) {
                log(`[LOOP ${cycle}] No tabs found (x${state._noTabCycles})`);
            }
        } else {
            if (state._noTabCycles > 0) log(`[LOOP ${cycle}] Found ${tabsAfter.length} tabs (recovered)`);
            state._noTabCycles = 0;
        }

        // Step 6: Update tab names (triggers overlay loading)
        updateTabNames(tabsAfter);

        // Step 7: Click next tab in rotation
        let targetIdx = -1;
        if (tabsAfter.length > 0) {
            targetIdx = index % tabsAfter.length;
            const targetTab = tabsAfter[targetIdx];
            const clickedTabName = stripTimeSuffix(targetTab.textContent);
            log(`[LOOP ${cycle}] Rotating to tab "${clickedTabName}"`);
            targetTab.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
            index++;
        }

        // Step 8: Wait 1500ms
        await new Promise(r => setTimeout(r, 1500));

        // Step 9: Check for completion badges after tab switch
        const badgesAfter = queryAll(SELECTORS.badgeTag).filter(s => {
            const t = s.textContent.trim();
            return SELECTORS.badgeTexts.includes(t);
        });

        // Step 10: Mark conversation completed using deduplicated name from state
        if (badgesAfter.length > 0 && targetIdx >= 0) {
            const deduplicatedNames = state.tabNames || [];
            const deduplicatedName = deduplicatedNames[targetIdx];
            if (deduplicatedName) {
                updateConversationCompletionState(deduplicatedName, 'done');
            }
        }

        // Step 11: Wait 3000ms
        await new Promise(r => setTimeout(r, 3000));
    }
    log('[FLOW] antigravityLoop STOPPED');
}
