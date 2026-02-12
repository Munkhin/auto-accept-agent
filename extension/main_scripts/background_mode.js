/**
 * Background Mode Algorithm - With Visual Overlay
 *
 * This script runs the background mode clicking/tab-switching algorithm
 * with full verbose logging AND creates a visual overlay showing progress.
 *
 * Features:
 * - Automatic tab cycling with button clicking
 * - Badge detection (Good/Bad) for completion tracking
 * - Visual overlay with progress bars for each conversation
 * - Real-time status updates (IN PROGRESS → COMPLETED)
 *
 * Usage:
 * 1. Open DevTools console in Cursor or Antigravity IDE
 * 2. Copy-paste this entire script
 * 3. Call: startBackgroundLoop('antigravity') or startBackgroundLoop('cursor')
 * 4. Call: stopBackgroundLoop() to stop
 *
 * All logs are prefixed with [BgLoop] for easy filtering.
 */

(function() {
    'use strict';

    // --- Page fingerprint for debugging ---
    const _pageUrl = (window.location && window.location.href) || 'unknown';
    const _pageTitle = (document.title || '').substring(0, 40);
    const _pageFP = `[${_pageTitle}|${_pageUrl.slice(-50)}]`;

    function log(msg) {
        console.log(`[BgLoop]${_pageFP} ${msg}`);
    }

    log('Script loaded');

    // --- OVERLAY CONSTANTS ---
    const OVERLAY_ID = '__autoAcceptBgOverlay';
    const STYLE_ID = '__autoAcceptBgStyles';

    const OVERLAY_STYLES = `
        #__autoAcceptBgOverlay {
            position: fixed;
            background: rgba(0, 0, 0, 0.97);
            z-index: 2147483647;
            font-family: system-ui, -apple-system, sans-serif;
            color: #fff;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s ease;
            overflow: hidden;
        }
        #__autoAcceptBgOverlay.visible { opacity: 1; }

        .aab-container {
            width: 90%;
            max-width: 420px;
            padding: 24px;
        }

        .aab-slot {
            margin-bottom: 16px;
            padding: 12px 16px;
            background: rgba(255, 255, 255, 0.03);
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .aab-header {
            display: flex;
            align-items: center;
            margin-bottom: 8px;
            gap: 10px;
        }

        .aab-name {
            flex: 1;
            font-size: 13px;
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: #e0e0e0;
        }

        .aab-status {
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            padding: 3px 8px;
            border-radius: 4px;
        }

        .aab-slot.in-progress .aab-status {
            color: #a855f7;
            background: rgba(168, 85, 247, 0.15);
        }

        .aab-slot.completed .aab-status {
            color: #22c55e;
            background: rgba(34, 197, 94, 0.15);
        }

        .aab-progress-track {
            height: 4px;
            background: rgba(255, 255, 255, 0.08);
            border-radius: 2px;
            overflow: hidden;
        }

        .aab-progress-fill {
            height: 100%;
            border-radius: 2px;
            transition: width 0.4s ease, background 0.3s ease;
        }

        .aab-slot.in-progress .aab-progress-fill {
            width: 60%;
            background: linear-gradient(90deg, #a855f7, #8b5cf6);
            animation: pulse-progress 1.5s ease-in-out infinite;
        }

        .aab-slot.completed .aab-progress-fill {
            width: 100%;
            background: linear-gradient(90deg, #22c55e, #16a34a);
        }

        @keyframes pulse-progress {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
        }
    `;

    // --- UTILS ---
    const getDocuments = (root = document) => {
        let docs = [root];
        try {
            const iframes = root.querySelectorAll('iframe, frame');
            for (const iframe of iframes) {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (iframeDoc) docs.push(...getDocuments(iframeDoc));
                } catch (e) { }
            }
        } catch (e) { }
        return docs;
    };

    const queryAll = (selector) => {
        const results = [];
        getDocuments().forEach(doc => {
            try { results.push(...Array.from(doc.querySelectorAll(selector))); } catch (e) { }
        });
        return results;
    };

    const stripTimeSuffix = (text) => {
        return (text || '').trim().replace(/\s*\d+[smh]$/, '').trim();
    };

    const deduplicateNames = (names) => {
        const counts = {};
        return names.map(name => {
            if (counts[name] === undefined) {
                counts[name] = 1;
                return name;
            } else {
                counts[name]++;
                return `${name} (${counts[name]})`;
            }
        });
    };

    const updateTabNames = (tabs) => {
        const rawNames = Array.from(tabs).map((tab, idx) => {
            // DEBUG: Log complete button structure
            log(`[TabName] === Tab ${idx} Debug Info ===`);
            log(`[TabName] Tag: ${tab.tagName}, Classes: ${tab.className}`);
            log(`[TabName] Attributes: ${Array.from(tab.attributes).map(a => `${a.name}="${a.value}"`).join(', ')}`);
            log(`[TabName] Full HTML (first 200 chars): ${tab.outerHTML.substring(0, 200)}`);

            // Log all direct children
            log(`[TabName] Direct children (${tab.children.length}):`);
            Array.from(tab.children).forEach((child, i) => {
                log(`[TabName]   Child ${i}: <${child.tagName}> class="${child.className}" text="${child.textContent.substring(0, 50).replace(/\n/g, '\\n')}"`);
            });

            // Log all spans
            const allSpans = tab.querySelectorAll('span');
            log(`[TabName] All spans (${allSpans.length}):`);
            allSpans.forEach((span, i) => {
                log(`[TabName]   Span ${i}: class="${span.className}" text="${span.textContent.substring(0, 50).replace(/\n/g, '\\n')}"`);
            });

            // The actual tab name is usually the LAST line of the text content
            // (code snippets/content come before the conversation name)
            const fullText = tab.textContent.trim();
            const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            if (lines.length > 0) {
                // Try last line first (most likely to be the conversation name)
                const lastLine = lines[lines.length - 1];
                if (lastLine.length > 0 && lastLine.length < 100) {
                    log(`[TabName] Tab ${idx}: Using LAST line: "${lastLine.substring(0, 50)}"`);
                    return stripTimeSuffix(lastLine);
                }

                // If last line is too long, try to find a short line that's not code
                for (let i = lines.length - 1; i >= 0; i--) {
                    const line = lines[i];
                    if (line.length > 0 && line.length < 100 && !line.startsWith('//') && !line.startsWith('/*') && !line.includes('{')) {
                        log(`[TabName] Tab ${idx}: Using line ${i}: "${line.substring(0, 50)}"`);
                        return stripTimeSuffix(line);
                    }
                }
            }

            // Last resort: use first 50 chars of full text
            log(`[TabName] Tab ${idx}: FALLBACK - Using truncated text: "${fullText.substring(0, 50)}"`);
            return stripTimeSuffix(fullText.substring(0, 50));
        });
        const tabNames = deduplicateNames(rawNames);

        if (tabNames.length === 0 && window.__bgLoopState?.tabNames?.length > 0) {
            log(`updateTabNames: Tabs temporarily empty, keeping previous state (${window.__bgLoopState.tabNames.length} tabs)`);
            return;
        }

        const tabNamesChanged = JSON.stringify(window.__bgLoopState?.tabNames) !== JSON.stringify(tabNames);

        if (tabNamesChanged) {
            log(`updateTabNames: Detected ${tabNames.length} tabs: ${tabNames.join(', ')}`);
            if (window.__bgLoopState) {
                window.__bgLoopState.tabNames = tabNames;
            }
        }

        // EVENT 2: Load tabs onto overlay when conversations tab detected (3+ tabs)
        // Load if: (1) tabs changed OR (2) overlay exists but is empty (just mounted)
        if (tabNames.length >= 3) {
            const container = document.getElementById(OVERLAY_ID + '-c');
            const needsLoad = tabNamesChanged || (container && container.children.length === 0);
            if (needsLoad) {
                loadTabsOntoOverlay(tabNames);
            }
        }
    };

    // --- OVERLAY FUNCTIONS ---
    function mountOverlay() {
        if (document.getElementById(OVERLAY_ID)) {
            log('[Overlay] Already mounted');
            return;
        }

        log('[Overlay] Mounting overlay...');

        // Inject styles
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = OVERLAY_STYLES;
            document.head.appendChild(style);
        }

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;

        const container = document.createElement('div');
        container.className = 'aab-container';
        container.id = OVERLAY_ID + '-c';

        overlay.appendChild(container);
        document.body.appendChild(overlay);

        // Find AI panel (Antigravity panel has highest priority)
        const panelSelectors = [
            '#antigravity\\.agentPanel',
            '#workbench\\.parts\\.auxiliarybar',
            '.auxiliary-bar-container',
            '#workbench\\.parts\\.sidebar'
        ];

        let panel = null;
        for (const selector of panelSelectors) {
            const found = queryAll(selector).find(p => p.offsetWidth > 50);
            if (found) {
                panel = found;
                log(`[Overlay] Found AI panel: ${selector}`);
                break;
            }
        }

        // Sync overlay position with panel
        const syncPosition = () => {
            if (panel) {
                const rect = panel.getBoundingClientRect();
                overlay.style.top = rect.top + 'px';
                overlay.style.left = rect.left + 'px';
                overlay.style.width = rect.width + 'px';
                overlay.style.height = rect.height + 'px';
            } else {
                overlay.style.top = '0';
                overlay.style.left = '0';
                overlay.style.width = '100%';
                overlay.style.height = '100%';
            }
        };

        syncPosition();

        if (panel) {
            const resizeObserver = new ResizeObserver(syncPosition);
            resizeObserver.observe(panel);
            overlay._resizeObserver = resizeObserver;
        }

        requestAnimationFrame(() => overlay.classList.add('visible'));
        log('[Overlay] Overlay mounted');
    }

    function dismountOverlay() {
        const overlay = document.getElementById(OVERLAY_ID);
        if (!overlay) return;

        log('[Overlay] Dismounting overlay...');
        if (overlay._resizeObserver) {
            overlay._resizeObserver.disconnect();
        }
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 300);
    }

    function loadTabsOntoOverlay(tabNames) {
        log(`[Overlay] loadTabsOntoOverlay called with ${tabNames ? tabNames.length : 'null'} tabs`);
        const container = document.getElementById(OVERLAY_ID + '-c');
        if (!container) {
            log(`[Overlay] Container not found! Overlay may not be mounted.`);
            return;
        }
        if (!tabNames || tabNames.length === 0) {
            log(`[Overlay] No tab names provided, skipping load.`);
            return;
        }

        log(`[Overlay] Loading ${tabNames.length} tabs onto overlay`);

        // Clear container safely without innerHTML (Trusted Types compliance)
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        const completionStatus = window.__bgLoopState?.completionStatus || {};

        tabNames.forEach(name => {
            const isCompleted = completionStatus[name] === 'done' || completionStatus[name] === 'done-errors';
            const stateClass = isCompleted ? 'completed' : 'in-progress';
            const statusText = isCompleted ? 'COMPLETED' : 'IN PROGRESS';

            const slot = document.createElement('div');
            slot.className = `aab-slot ${stateClass}`;
            slot.setAttribute('data-name', name);

            const header = document.createElement('div');
            header.className = 'aab-header';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'aab-name';
            nameSpan.textContent = name;
            header.appendChild(nameSpan);

            const statusSpan = document.createElement('span');
            statusSpan.className = 'aab-status';
            statusSpan.textContent = statusText;
            header.appendChild(statusSpan);

            slot.appendChild(header);

            const track = document.createElement('div');
            track.className = 'aab-progress-track';
            const fill = document.createElement('div');
            fill.className = 'aab-progress-fill';
            track.appendChild(fill);
            slot.appendChild(track);

            container.appendChild(slot);
        });
    }

    function markTabCompleted(tabName) {
        const container = document.getElementById(OVERLAY_ID + '-c');
        if (!container) return;

        // FIX: Use DOM iteration instead of CSS.escape
        const slots = container.querySelectorAll('.aab-slot');
        for (const slot of slots) {
            if (slot.getAttribute('data-name') === tabName) {
                if (!slot.classList.contains('completed')) {
                    log(`[Overlay] Marking "${tabName}" as completed`);
                    slot.classList.remove('in-progress');
                    slot.classList.add('completed');
                    const statusSpan = slot.querySelector('.aab-status');
                    if (statusSpan) statusSpan.textContent = 'COMPLETED';
                }
                break;
            }
        }
    }

    // --- BUTTON CLICKING ---
    function isAcceptButton(el) {
        const text = (el.textContent || "").trim().toLowerCase();
        if (text.length === 0 || text.length > 50) return false;
        const patterns = ['accept', 'run', 'retry', 'apply', 'execute', 'confirm', 'allow once', 'allow'];
        const rejects = ['skip', 'reject', 'cancel', 'close', 'refine'];
        if (rejects.some(r => text.includes(r))) return false;
        if (!patterns.some(p => text.includes(p))) return false;

        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && rect.width > 0 && style.pointerEvents !== 'none' && !el.disabled;
    }

    function isElementVisible(el) {
        if (!el || !el.isConnected) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && rect.width > 0 && style.visibility !== 'hidden';
    }

    function waitForDisappear(el, timeout = 500) {
        return new Promise(resolve => {
            const startTime = Date.now();
            const check = () => {
                if (!isElementVisible(el)) {
                    resolve(true);
                } else if (Date.now() - startTime >= timeout) {
                    resolve(false);
                } else {
                    requestAnimationFrame(check);
                }
            };
            setTimeout(check, 50);
        });
    }

    // v8 simple poll approach: flat loop, immediate click, no waitForDisappear
    function performClick(selectors) {
        const found = [];
        selectors.forEach(s => queryAll(s).forEach(el => found.push(el)));
        const uniqueFound = [...new Set(found)];
        let clicked = 0;

        for (const el of uniqueFound) {
            if (isAcceptButton(el)) {
                const buttonText = (el.textContent || "").trim();
                log(`Clicking: "${buttonText}"`);
                el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                clicked++;
            }
        }

        if (clicked > 0) {
            log(`[Click] Clicked ${clicked} button(s)`);
        }
        return clicked;
    }

    // --- COMPILATION ERROR DETECTION ---
    function hasCompilationErrors() {
        const errorBadges = queryAll('.codicon-error, .codicon-warning, [class*="marker-count"]');
        for (const badge of errorBadges) {
            const text = (badge.textContent || '').trim();
            const num = parseInt(text, 10);
            if (!isNaN(num) && num > 0) {
                log(`[Compile] Found error badge with count: ${num}`);
                return true;
            }
        }

        const errorDecorations = queryAll('.squiggly-error, .monaco-editor .squiggly-error');
        if (errorDecorations.length > 0) {
            log(`[Compile] Found ${errorDecorations.length} error squiggles in editor`);
            return true;
        }

        const errorSpans = queryAll('span').filter(s => {
            const t = s.textContent.trim().toLowerCase();
            return t === 'error' || t === 'failed' || t === 'compilation error';
        });
        if (errorSpans.length > 0) {
            log(`[Compile] Found error text spans: ${errorSpans.length}`);
            return true;
        }

        return false;
    }

    // --- COMPLETION STATE ---
    const updateConversationCompletionState = (rawTabName, status) => {
        const tabName = stripTimeSuffix(rawTabName);
        const current = window.__bgLoopState?.completionStatus?.[tabName];
        if (current !== status) {
            log(`[State] ${tabName}: ${current} → ${status}`);
            if (window.__bgLoopState) {
                window.__bgLoopState.completionStatus[tabName] = status;
            }
        }
    };

    // --- CURSOR LOOP ---
    async function cursorLoop(sid) {
        log('[Loop] cursorLoop STARTED');
        let index = 0;
        let cycle = 0;
        const state = window.__bgLoopState;
        state._noTabCycles = 0;

        while (state.isRunning && state.sessionID === sid) {
            cycle++;
            log(`[Loop] Cycle ${cycle}: Starting...`);

            const clicked = performClick(['button', '[class*="button"]', '[class*="anysphere"]', '.bg-ide-button-background']);
            log(`[Loop] Cycle ${cycle}: Clicked ${clicked} buttons`);

            await new Promise(r => setTimeout(r, 800));

            const tabSelectors = [
                '#workbench\\.parts\\.auxiliarybar ul[role="tablist"] li[role="tab"]',
                '.monaco-pane-view .monaco-list-row[role="listitem"]',
                'div[role="tablist"] div[role="tab"]',
                '.chat-session-item'
            ];

            let tabs = [];
            for (const selector of tabSelectors) {
                tabs = queryAll(selector);
                if (tabs.length > 0) {
                    log(`[Loop] Cycle ${cycle}: Found ${tabs.length} tabs using selector: ${selector}`);
                    break;
                }
            }

            if (tabs.length === 0) {
                state._noTabCycles++;
                log(`[Loop] Cycle ${cycle}: No tabs found (consecutive: ${state._noTabCycles})`);
            } else {
                state._noTabCycles = 0;
            }

            updateTabNames(tabs);

            if (tabs.length > 0) {
                const targetTab = tabs[index % tabs.length];
                const tabLabel = targetTab.getAttribute('aria-label') || targetTab.textContent?.trim() || 'unnamed tab';
                log(`[Loop] Cycle ${cycle}: Clicking tab "${tabLabel}"`);
                targetTab.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                index++;
            }

            log(`[Loop] Cycle ${cycle}: State = { tabs: ${state.tabNames?.length || 0}, isRunning: ${state.isRunning}, sid: ${state.sessionID} }`);
            log(`[Loop] Cycle ${cycle}: Waiting 3s...`);

            await new Promise(r => setTimeout(r, 3000));
        }
        log('[Loop] cursorLoop STOPPED');
    }

    // --- ANTIGRAVITY LOOP ---
    async function antigravityLoop(sid) {
        log('[Loop] antigravityLoop STARTED');
        let index = 0;
        let cycle = 0;
        const state = window.__bgLoopState;
        state._noTabCycles = 0;

        while (state.isRunning && state.sessionID === sid) {
            cycle++;
            log(`[Loop] Cycle ${cycle}: Starting...`);

            // Check for completion badges (Good/Bad) BEFORE clicking
            const allSpans = queryAll('span');
            const feedbackBadges = allSpans.filter(s => {
                const t = s.textContent.trim();
                return t === 'Good' || t === 'Bad';
            });
            const hasBadge = feedbackBadges.length > 0;

            log(`[Loop] Cycle ${cycle}: Found ${feedbackBadges.length} Good/Bad badges`);

            let clicked = 0;
            if (!hasBadge) {
                clicked = performClick(['button', '[class*="button"]', '[class*="anysphere"]', '.bg-ide-button-background']);
                log(`[Loop] Cycle ${cycle}: Clicked ${clicked} accept buttons`);
            } else {
                log(`[Loop] Cycle ${cycle}: Skipping clicks - conversation is DONE (has badge)`);
            }

            await new Promise(r => setTimeout(r, 800));

            // Click tab panel button to ensure tabs are visible/cycled
            const nt = queryAll("[data-tooltip-id='new-conversation-tooltip']")[0];
            if (nt) {
                log(`[Loop] Cycle ${cycle}: Clicking tab panel button`);
                nt.click();
            }
            await new Promise(r => setTimeout(r, 1500));

            // Query existing tabs
            const tabsAfter = queryAll('button.grow');
            log(`[Loop] Cycle ${cycle}: Found ${tabsAfter.length} tabs`);

            if (tabsAfter.length === 0) {
                state._noTabCycles++;
                log(`[Loop] Cycle ${cycle}: No tabs found (consecutive: ${state._noTabCycles})`);
            } else {
                state._noTabCycles = 0;
            }

            updateTabNames(tabsAfter);

            // Click next tab in rotation
            let clickedTabName = null;
            if (tabsAfter.length > 0) {
                const targetTab = tabsAfter[index % tabsAfter.length];
                clickedTabName = stripTimeSuffix(targetTab.textContent);
                log(`[Loop] Cycle ${cycle}: Clicking tab "${clickedTabName}"`);
                targetTab.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                index++;
            }

            await new Promise(r => setTimeout(r, 1500));

            // Check for completion badges after clicking
            const allSpansAfter = queryAll('span');
            const feedbackTexts = allSpansAfter
                .filter(s => {
                    const t = s.textContent.trim();
                    return t === 'Good' || t === 'Bad';
                })
                .map(s => s.textContent.trim());

            log(`[Loop] Cycle ${cycle}: Found ${feedbackTexts.length} Good/Bad badges after tab switch`);

            // Update completion status
            if (clickedTabName && feedbackTexts.length > 0) {
                const hasErrors = hasCompilationErrors();
                const finalStatus = hasErrors ? 'done-errors' : 'done';
                updateConversationCompletionState(clickedTabName, finalStatus);

                // EVENT 3: Mark tab as completed on overlay
                // Use deduplicated name from state.tabNames
                const deduplicatedNames = state.tabNames || [];
                const currentIndex = (index - 1) % deduplicatedNames.length;
                const deduplicatedName = deduplicatedNames[currentIndex];
                if (deduplicatedName) {
                    markTabCompleted(deduplicatedName);
                }

                if (hasErrors) {
                    log(`[Loop] Cycle ${cycle}: Tab "${clickedTabName}" completed WITH compilation errors`);
                }
            } else if (clickedTabName && !state.completionStatus[clickedTabName]) {
                // Leave as undefined (WAITING)
            }

            log(`[Loop] Cycle ${cycle}: State = { tabs: ${state.tabNames?.length || 0}, completions: ${JSON.stringify(state.completionStatus)} }`);
            log(`[Loop] Cycle ${cycle}: Waiting 3s...`);

            await new Promise(r => setTimeout(r, 3000));
        }
        log('[Loop] antigravityLoop STOPPED');
    }

    // --- PUBLIC API ---
    window.startBackgroundLoop = function(ide = 'antigravity') {
        log(`startBackgroundLoop called: ide=${ide}`);

        if (!window.__bgLoopState) {
            window.__bgLoopState = {
                isRunning: false,
                tabNames: [],
                completionStatus: {},
                sessionID: 0,
                _noTabCycles: 0
            };
        }

        const state = window.__bgLoopState;

        if (state.isRunning) {
            log('Already running, stopping previous session...');
            state.isRunning = false;
        }

        state.isRunning = true;
        state.sessionID++;
        const sid = state.sessionID;

        // EVENT 1: Mount overlay when background loop starts
        mountOverlay();

        log(`Starting ${ide} loop (session ID: ${sid})...`);

        if (ide.toLowerCase() === 'cursor') {
            cursorLoop(sid);
        } else {
            antigravityLoop(sid);
        }

        log('✅ Background loop started! Check console for detailed logs.');
        log('💡 To stop: stopBackgroundLoop()');
    };

    window.stopBackgroundLoop = function() {
        if (window.__bgLoopState) {
            window.__bgLoopState.isRunning = false;
            window.__bgLoopState._noTabCycles = 0;

            // EVENT 1: Dismount overlay when background loop stops
            dismountOverlay();

            log('Background loop stopped.');
        } else {
            log('No loop running.');
        }
    };

    log('✅ Script initialized. Ready to start.');
    log('💡 Usage:');
    log('   startBackgroundLoop("antigravity")  // Start Antigravity loop');
    log('   startBackgroundLoop("cursor")       // Start Cursor loop');
    log('   stopBackgroundLoop()                // Stop the loop');
})();
