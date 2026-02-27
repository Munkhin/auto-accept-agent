/**
 * Auto Accept Agent - Combined Script v10.1
 *
 * Combines:
 * - simple_poll.js (button clicking, 300ms interval) - ALWAYS runs
 * - background_mode.js (tab cycling + overlay) - runs ONLY if background mode enabled
 *
 * Both loops run concurrently with NO race conditions because:
 * - Clicking loop: Only clicks buttons, doesn't touch tabs
 * - Tab/overlay loop: Only cycles tabs and updates overlay, doesn't click buttons
 *
 * API:
 *   window.__autoAcceptStart(config)  // config: {ide, isBackgroundMode}
 *   window.__autoAcceptStop()
 *   window.__autoAcceptGetStats()
 */
(function() {
    'use strict';

    if (typeof window === 'undefined') return;

    const log = (msg) => console.log(`[AutoAccept] ${msg}`);
    log('Script loaded');

    // =================================================================
    // SHARED: DOM UTILITIES
    // =================================================================

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
            try {
                results.push(...Array.from(doc.querySelectorAll(selector)));
            } catch (e) { }
        });
        return results;
    };

    // =================================================================
    // SIMPLE POLL: BUTTON CLICKING + BANNED COMMAND DETECTION
    // (ported from compositor + modules/03_clicking.js)
    // =================================================================

    const acceptPatterns = ['accept', 'run', 'retry', 'apply', 'execute', 'confirm', 'always allow', 'allow once', 'allow'];
    const rejectPatterns = ['skip', 'reject', 'cancel', 'close', 'refine'];
    const COMMAND_ELEMENTS = ['pre', 'code', 'pre code'];

    // --- BANNED COMMAND DETECTION (from modules/03_clicking.js) ---

    function findNearbyCommandText(el) {
        let commandText = '';

        // Walk up DOM tree looking for nearby <pre>/<code> elements
        let container = el.parentElement;
        let depth = 0;
        while (container && depth < 10) {
            let sibling = container.previousElementSibling;
            let siblingCount = 0;
            while (sibling && siblingCount < 5) {
                if (sibling.tagName === 'PRE' || sibling.tagName === 'CODE') {
                    const text = sibling.textContent.trim();
                    if (text.length > 0) commandText += ' ' + text;
                }
                for (const selector of COMMAND_ELEMENTS) {
                    try {
                        const codeElements = sibling.querySelectorAll(selector);
                        for (const codeEl of codeElements) {
                            if (codeEl && codeEl.textContent) {
                                const text = codeEl.textContent.trim();
                                if (text.length > 0 && text.length < 5000) commandText += ' ' + text;
                            }
                        }
                    } catch (e) { }
                }
                sibling = sibling.previousElementSibling;
                siblingCount++;
            }
            if (commandText.length > 10) break;
            container = container.parentElement;
            depth++;
        }

        // Fallback: check immediate button siblings
        if (commandText.length === 0) {
            let btnSibling = el.previousElementSibling;
            let count = 0;
            while (btnSibling && count < 3) {
                for (const selector of COMMAND_ELEMENTS) {
                    try {
                        const codeElements = btnSibling.querySelectorAll ? btnSibling.querySelectorAll(selector) : [];
                        for (const codeEl of codeElements) {
                            if (codeEl && codeEl.textContent) commandText += ' ' + codeEl.textContent.trim();
                        }
                    } catch (e) { }
                }
                btnSibling = btnSibling.previousElementSibling;
                count++;
            }
        }

        if (el.getAttribute('aria-label')) commandText += ' ' + el.getAttribute('aria-label');
        if (el.getAttribute('title')) commandText += ' ' + el.getAttribute('title');

        return commandText.trim().toLowerCase();
    }

    function isCommandBanned(commandText) {
        const state = window.__autoAcceptState;
        const bannedList = state ? (state.bannedCommands || []) : [];
        if (bannedList.length === 0 || !commandText) return false;

        const lowerText = commandText.toLowerCase();

        for (const banned of bannedList) {
            const pattern = (banned || '').trim();
            if (!pattern) continue;

            try {
                // Support regex patterns: /pattern/flags
                if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
                    const lastSlash = pattern.lastIndexOf('/');
                    const regex = new RegExp(pattern.substring(1, lastSlash), pattern.substring(lastSlash + 1) || 'i');
                    if (regex.test(commandText)) {
                        log(`[BANNED] Blocked by regex: ${pattern}`);
                        if (state) state.blocked = (state.blocked || 0) + 1;
                        return true;
                    }
                } else {
                    if (lowerText.includes(pattern.toLowerCase())) {
                        log(`[BANNED] Blocked by pattern: "${pattern}"`);
                        if (state) state.blocked = (state.blocked || 0) + 1;
                        return true;
                    }
                }
            } catch (e) {
                if (lowerText.includes(pattern.toLowerCase())) {
                    log(`[BANNED] Blocked (fallback): "${pattern}"`);
                    if (state) state.blocked = (state.blocked || 0) + 1;
                    return true;
                }
            }
        }
        return false;
    }

    // --- BUTTON DETECTION ---

    function isAcceptButton(el) {
        const text = (el.textContent || '').trim().toLowerCase();
        if (text.length === 0 || text.length > 50) return false;

        for (const rp of rejectPatterns) {
            if (text.indexOf(rp) !== -1) return false;
        }
        let matched = false;
        for (const ap of acceptPatterns) {
            if (text.indexOf(ap) !== -1) { matched = true; break; }
        }
        if (!matched) return false;

        // Check banned commands for run/execute buttons
        if (text.includes('run') || text.includes('execute')) {
            const nearbyText = findNearbyCommandText(el);
            if (isCommandBanned(nearbyText)) return false;
        }

        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && rect.width > 0 && style.pointerEvents !== 'none' && !el.disabled;
    }

    function getButtonSelectors() {
        const state = window.__autoAcceptState;
        const ide = state ? state.ide : 'cursor';
        if (ide === 'antigravity') {
            return ['.bg-ide-button-background', 'button.bg-primary', 'button.rounded-l'];
        }
        return ['button', '[class*="button"]', '[class*="anysphere"]'];
    }

    function clickAcceptButtons() {
        // Pause while user is manually interacting with the IDE
        if (window.__autoAcceptState?.userInteracting) return 0;
        const selectors = getButtonSelectors();
        let clicked = 0;
        for (const selector of selectors) {
            const els = queryAll(selector);
            for (const el of els) {
                if (isAcceptButton(el)) {
                    const btnText = (el.textContent || '').trim();
                    log(`Clicking: "${btnText}"`);
                    el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                    clicked++;
                    const state = window.__autoAcceptState;
                    if (state) state.clicks = (state.clicks || 0) + 1;
                }
            }
        }
        return clicked;
    }

    // =================================================================
    // BACKGROUND MODE: OVERLAY (from background_mode.js - proven working)
    // =================================================================

    const OVERLAY_ID = '__autoAcceptBgOverlay';
    const STYLE_ID = '__autoAcceptBgStyles';
    const SUMMARY_WIDGET_ID = '__autoAcceptSummaryWidget';
    const SUMMARY_STYLE_ID = '__autoAcceptSummaryStyles';
    const SUMMARY_BUTTON_ID = '__autoAcceptSummaryButton';
    const SUMMARY_STATUS_ID = '__autoAcceptSummaryStatus';
    const SUMMARY_BODY_ID = '__autoAcceptSummaryBody';
    const PANEL_SELECTORS = [
        '#antigravity\\.agentPanel',
        '#workbench\\.parts\\.auxiliarybar',
        '.auxiliary-bar-container',
        '#workbench\\.parts\\.sidebar'
    ];

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

    const SUMMARY_STYLES = `
        #__autoAcceptSummaryWidget {
            position: fixed;
            z-index: 2147483646;
            width: 340px;
            max-height: 60vh;
            padding: 12px;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.14);
            background: rgba(12, 12, 16, 0.96);
            color: #f6f6f6;
            box-shadow: 0 12px 28px rgba(0, 0, 0, 0.4);
            display: flex;
            flex-direction: column;
            gap: 8px;
            font-family: system-ui, -apple-system, sans-serif;
        }
        #__autoAcceptSummaryWidget .aas-title {
            font-size: 12px;
            font-weight: 600;
            opacity: 0.95;
            letter-spacing: 0.2px;
        }
        #__autoAcceptSummaryButton {
            height: 30px;
            border: 0;
            border-radius: 6px;
            background: #2563eb;
            color: #fff;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
        }
        #__autoAcceptSummaryButton[disabled] {
            opacity: 0.6;
            cursor: default;
        }
        #__autoAcceptSummaryStatus {
            font-size: 11px;
            min-height: 15px;
            opacity: 0.8;
        }
        #__autoAcceptSummaryBody {
            white-space: pre-wrap;
            font-size: 12px;
            line-height: 1.45;
            overflow: auto;
            max-height: 42vh;
            padding-right: 2px;
        }
        #__autoAcceptSummaryWidget.error #__autoAcceptSummaryStatus {
            color: #fca5a5;
        }
    `;

    function isElementVisible(el) {
        if (!el || !el.ownerDocument) return false;
        try {
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        } catch (e) {
            return false;
        }
    }

    function findAgentPanel() {
        for (const selector of PANEL_SELECTORS) {
            const found = queryAll(selector).find(p => p.offsetWidth > 50 && p.offsetHeight > 50);
            if (found) return found;
        }
        return null;
    }

    // --- Tab name utilities (from background_mode.js) ---

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
        const rawNames = Array.from(tabs).map((tab) => {
            const fullText = tab.textContent.trim();
            const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            if (lines.length > 0) {
                const lastLine = lines[lines.length - 1];
                if (lastLine.length > 0 && lastLine.length < 100) {
                    return stripTimeSuffix(lastLine);
                }
                for (let i = lines.length - 1; i >= 0; i--) {
                    const line = lines[i];
                    if (line.length > 0 && line.length < 100 && !line.startsWith('//') && !line.startsWith('/*') && !line.includes('{')) {
                        return stripTimeSuffix(line);
                    }
                }
            }

            return stripTimeSuffix(fullText.substring(0, 50));
        });
        const tabNames = deduplicateNames(rawNames);

        if (tabNames.length === 0 && window.__autoAcceptState?.tabNames?.length > 0) {
            return;
        }

        const tabNamesChanged = JSON.stringify(window.__autoAcceptState?.tabNames) !== JSON.stringify(tabNames);

        if (tabNamesChanged) {
            log(`[Tabs] Detected ${tabNames.length} tabs: ${tabNames.join(', ')}`);
            if (window.__autoAcceptState) {
                window.__autoAcceptState.tabNames = tabNames;
            }
        }

        if (tabNames.length >= 3) {
            const container = document.getElementById(OVERLAY_ID + '-c');
            const needsLoad = tabNamesChanged || (container && container.children.length === 0);
            if (needsLoad) {
                loadTabsOntoOverlay(tabNames);
            }
        }
    };

    // --- Overlay functions (from background_mode.js) ---

    function mountOverlay() {
        if (document.getElementById(OVERLAY_ID)) {
            log('[Overlay] Already mounted');
            return;
        }

        log('[Overlay] Mounting overlay...');

        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = OVERLAY_STYLES;
            document.head.appendChild(style);
        }

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;

        const container = document.createElement('div');
        container.className = 'aab-container';
        container.id = OVERLAY_ID + '-c';

        overlay.appendChild(container);
        document.body.appendChild(overlay);

        let panel = null;
        for (const selector of PANEL_SELECTORS) {
            const found = queryAll(selector).find(p => p.offsetWidth > 50);
            if (found) {
                panel = found;
                log(`[Overlay] Found AI panel: ${selector}`);
                break;
            }
        }

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

    function setSummaryWidgetState(payload) {
        const widget = document.getElementById(SUMMARY_WIDGET_ID);
        if (!widget) return;
        const button = document.getElementById(SUMMARY_BUTTON_ID);
        const status = document.getElementById(SUMMARY_STATUS_ID);
        const body = document.getElementById(SUMMARY_BODY_ID);
        const state = payload || {};
        const statusType = state.status || 'idle';

        widget.classList.toggle('error', statusType === 'error');

        if (statusType === 'loading') {
            if (button) {
                button.disabled = true;
                button.textContent = 'Summarizing...';
            }
            if (status) status.textContent = 'Generating session recap...';
            if (body && !body.textContent) body.textContent = '';
            return;
        }

        if (statusType === 'success') {
            if (button) {
                button.disabled = false;
                button.textContent = 'Regenerate Summary';
            }
            if (status) status.textContent = `Updated ${new Date().toLocaleTimeString()}`;
            if (body) body.textContent = String(state.summary || '').trim();
            return;
        }

        if (statusType === 'error') {
            if (button) {
                button.disabled = false;
                button.textContent = 'Retry Summary';
            }
            if (status) status.textContent = String(state.error || 'Failed to generate summary.');
            if (body && !body.textContent) body.textContent = '';
            return;
        }

        if (button) {
            button.disabled = false;
            button.textContent = 'Summarize Session';
        }
        if (status) status.textContent = 'Click to generate a recap for this session.';
    }

    function mountSummaryWidget() {
        if (document.getElementById(SUMMARY_WIDGET_ID)) return;

        if (!document.getElementById(SUMMARY_STYLE_ID)) {
            const style = document.createElement('style');
            style.id = SUMMARY_STYLE_ID;
            style.textContent = SUMMARY_STYLES;
            document.head.appendChild(style);
        }

        const widget = document.createElement('div');
        widget.id = SUMMARY_WIDGET_ID;
        widget.innerHTML = `
            <div class="aas-title">Auto Accept Session Recap</div>
            <button id="${SUMMARY_BUTTON_ID}" type="button">Summarize Session</button>
            <div id="${SUMMARY_STATUS_ID}"></div>
            <div id="${SUMMARY_BODY_ID}"></div>
        `;
        document.body.appendChild(widget);

        const panel = findAgentPanel();
        const syncPosition = () => {
            if (panel && panel.getBoundingClientRect) {
                const rect = panel.getBoundingClientRect();
                widget.style.left = `${Math.max(8, rect.right - widget.offsetWidth - 12)}px`;
                widget.style.top = `${Math.max(8, rect.bottom - Math.min(rect.height - 10, widget.offsetHeight + 12))}px`;
            } else {
                widget.style.right = '18px';
                widget.style.bottom = '18px';
                widget.style.left = 'auto';
                widget.style.top = 'auto';
            }
        };
        syncPosition();
        widget._onWindowResize = syncPosition;
        window.addEventListener('resize', syncPosition);

        if (panel) {
            const resizeObserver = new ResizeObserver(syncPosition);
            resizeObserver.observe(panel);
            widget._resizeObserver = resizeObserver;
        }

        const button = document.getElementById(SUMMARY_BUTTON_ID);
        if (button) {
            button.addEventListener('click', () => {
                const state = window.__autoAcceptState;
                if (!state || state.summaryRequestPending) return;
                state.summaryRequestPending = true;
                state.summaryRequestedAt = Date.now();
                setSummaryWidgetState({ status: 'loading' });
            });
        }

        setSummaryWidgetState({ status: 'idle' });
        log('[Summary] Widget mounted');
    }

    function dismountSummaryWidget() {
        const widget = document.getElementById(SUMMARY_WIDGET_ID);
        if (!widget) return;
        if (widget._resizeObserver) widget._resizeObserver.disconnect();
        if (widget._onWindowResize) window.removeEventListener('resize', widget._onWindowResize);
        widget.remove();
        log('[Summary] Widget dismounted');
    }

    function collectVisibleConversationText(maxChars = 12000) {
        const root = findAgentPanel() || document.body;
        if (!root) return '';

        const selectors = [
            '[data-role="assistant"]',
            '[data-testid*="assistant"]',
            '.assistant',
            '.message.assistant',
            '.chat-message',
            '.markdown',
            'article',
            'p',
            'li',
            'pre',
            'code'
        ];

        const snippets = [];
        const seen = new Set();
        let total = 0;
        let stop = false;

        for (const selector of selectors) {
            if (stop) break;
            let elements = [];
            try {
                elements = Array.from(root.querySelectorAll(selector));
            } catch (e) {
                elements = [];
            }
            for (const el of elements) {
                if (!isElementVisible(el)) continue;
                let text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                if (text.length < 24) continue;
                if (text.length > 1800) {
                    text = `${text.slice(0, 1800)}...`;
                }
                const key = text.slice(0, 160);
                if (seen.has(key)) continue;
                seen.add(key);
                snippets.push(text);
                total += text.length + 2;
                if (total >= maxChars) {
                    stop = true;
                    break;
                }
            }
        }

        if (snippets.length === 0) {
            const fallback = (root.innerText || '').replace(/\s+/g, ' ').trim();
            return fallback.slice(0, maxChars);
        }

        return snippets.join('\n\n').slice(0, maxChars);
    }

    function loadTabsOntoOverlay(tabNames) {
        const container = document.getElementById(OVERLAY_ID + '-c');
        if (!container || !tabNames || tabNames.length === 0) return;

        log(`[Overlay] Loading ${tabNames.length} tabs onto overlay`);

        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        const completionStatus = window.__autoAcceptState?.completionStatus || {};

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

    // --- Compilation error detection (from background_mode.js) ---

    function hasCompilationErrors() {
        const errorBadges = queryAll('.codicon-error, .codicon-warning, [class*="marker-count"]');
        for (const badge of errorBadges) {
            const text = (badge.textContent || '').trim();
            const num = parseInt(text, 10);
            if (!isNaN(num) && num > 0) return true;
        }

        const errorDecorations = queryAll('.squiggly-error, .monaco-editor .squiggly-error');
        if (errorDecorations.length > 0) return true;

        return false;
    }

    // --- Completion state tracking (from background_mode.js) ---

    const updateConversationCompletionState = (rawTabName, status) => {
        const tabName = stripTimeSuffix(rawTabName);
        const current = window.__autoAcceptState?.completionStatus?.[tabName];
        if (current !== status) {
            log(`[State] ${tabName}: ${current} -> ${status}`);
            if (window.__autoAcceptState) {
                window.__autoAcceptState.completionStatus[tabName] = status;
            }
        }
    };

    // =================================================================
    // BACKGROUND MODE: TAB CYCLING LOOPS (from background_mode.js)
    // ONLY tab switching + overlay updating. NO button clicking.
    // Button clicking is handled by the simple poll interval above.
    // =================================================================

    const CURSOR_TAB_SELECTORS = [
        '#workbench\\.parts\\.auxiliarybar ul[role="tablist"] li[role="tab"]',
        '.monaco-pane-view .monaco-list-row[role="listitem"]',
        'div[role="tablist"] div[role="tab"]',
        '.chat-session-item'
    ];

    const ANTIGRAVITY_TAB_SELECTOR = 'button.grow';
    const NEW_CONVERSATION_SELECTOR = "[data-tooltip-id='new-conversation-tooltip']";

    // Helper: check if this loop session is still active
    function isSessionActive(state, sessionID) {
        return state.isRunning && state.sessionID === sessionID;
    }

    async function cursorTabLoop(sessionID) {
        log('[TabLoop] Cursor tab cycling started');
        let index = 0;
        let cycle = 0;
        const state = window.__autoAcceptState;
        state._noTabCycles = 0;

        while (isSessionActive(state, sessionID)) {
            cycle++;

            // Find tabs (try multiple selectors)
            let tabs = [];
            for (const selector of CURSOR_TAB_SELECTORS) {
                tabs = queryAll(selector);
                if (tabs.length > 0) break;
            }

            if (tabs.length === 0) {
                state._noTabCycles++;
            } else {
                state._noTabCycles = 0;
            }

            // Update tab names on overlay
            updateTabNames(tabs);

            // Click next tab in rotation
            if (tabs.length > 0) {
                const targetTab = tabs[index % tabs.length];
                const tabLabel = targetTab.getAttribute('aria-label') || targetTab.textContent?.trim() || 'unnamed';
                log(`[TabLoop] Cycle ${cycle}: Switching to tab "${tabLabel.substring(0, 40)}"`);
                targetTab.dispatchEvent(new MouseEvent('click', {
                    view: window,
                    bubbles: true,
                    cancelable: true
                }));
                index++;
            }

            // Wait 3s before next cycle (let tab content load, let clicking loop work)
            await new Promise(r => setTimeout(r, 3000));
        }

        log('[TabLoop] Cursor tab cycling stopped');
    }

    async function antigravityTabLoop(sessionID) {
        log('[TabLoop] Antigravity tab cycling started');
        let index = 0;
        let cycle = 0;
        const state = window.__autoAcceptState;
        state._noTabCycles = 0;

        while (isSessionActive(state, sessionID)) {
            cycle++;

            // Check for completion badges (Good/Bad) on current tab
            const allSpans = queryAll('span');
            const feedbackBadges = allSpans.filter(s => {
                const t = s.textContent.trim();
                return t === 'Good' || t === 'Bad';
            });
            log(`[TabLoop] Cycle ${cycle}: ${feedbackBadges.length} badges on current tab`);

            // Step 1: Click "New Conversation" button to show tabs panel
            const nt = queryAll(NEW_CONVERSATION_SELECTOR)[0];
            if (nt) nt.click();

            // Step 2: Wait 1500ms for panel to appear (critical timing from v9.0.0)
            await new Promise(r => setTimeout(r, 1500));
            if (!isSessionActive(state, sessionID)) break;

            // Step 3: Find tabs
            const tabs = queryAll(ANTIGRAVITY_TAB_SELECTOR);

            if (tabs.length === 0) {
                state._noTabCycles++;
                log(`[TabLoop] Cycle ${cycle}: No tabs found (consecutive: ${state._noTabCycles})`);
            } else {
                state._noTabCycles = 0;
            }

            // Update tab names on overlay
            updateTabNames(tabs);

            // Step 4: Click next tab in rotation
            let clickedTabName = null;
            if (tabs.length > 0) {
                const targetTab = tabs[index % tabs.length];
                clickedTabName = stripTimeSuffix(targetTab.textContent);
                log(`[TabLoop] Cycle ${cycle}: Switching to tab "${clickedTabName}"`);
                targetTab.dispatchEvent(new MouseEvent('click', {
                    view: window,
                    bubbles: true,
                    cancelable: true
                }));
                index++;
            }

            // Step 5: Wait 1500ms for tab content to load
            await new Promise(r => setTimeout(r, 1500));
            if (!isSessionActive(state, sessionID)) break;

            // Step 6: Check for completion badges AFTER tab switch
            const allSpansAfter = queryAll('span');
            const feedbackTexts = allSpansAfter
                .filter(s => {
                    const t = s.textContent.trim();
                    return t === 'Good' || t === 'Bad';
                })
                .map(s => s.textContent.trim());

            // Update completion status on overlay
            if (clickedTabName && feedbackTexts.length > 0) {
                const hasErrors = hasCompilationErrors();
                const finalStatus = hasErrors ? 'done-errors' : 'done';
                updateConversationCompletionState(clickedTabName, finalStatus);

                const deduplicatedNames = state.tabNames || [];
                const currentIndex = (index - 1) % deduplicatedNames.length;
                const deduplicatedName = deduplicatedNames[currentIndex];
                if (deduplicatedName) {
                    markTabCompleted(deduplicatedName);
                }

                if (hasErrors) {
                    log(`[TabLoop] Cycle ${cycle}: Tab "${clickedTabName}" completed WITH errors`);
                }
            }

            log(`[TabLoop] Cycle ${cycle}: ${state.tabNames?.length || 0} tabs, completions: ${JSON.stringify(state.completionStatus)}`);

            // Step 7: Wait 3s before next cycle (let clicking loop work on new tab)
            await new Promise(r => setTimeout(r, 3000));
        }

        log('[TabLoop] Antigravity tab cycling stopped');
    }

    // =================================================================
    // STATE & PUBLIC API
    // =================================================================

    if (!window.__autoAcceptState) {
        window.__autoAcceptState = {
            isRunning: false,
            sessionID: 0,
            clicks: 0,
            blocked: 0,
            fileEdits: 0,
            terminalCommands: 0,
            clickInterval: null,
            mode: null,
            ide: null,
            pollInterval: 1000,
            bannedCommands: [],
            // Background mode fields (from background_mode.js)
            tabNames: [],
            completionStatus: {},
            _noTabCycles: 0,
            summaryRequestPending: false,
            summaryRequestedAt: 0,
            lastSummary: '',
            // User interaction pause
            userInteracting: false,
            _userInteractingTimer: null,
            _onUserInteract: null
        };
    }

    window.__autoAcceptGetStats = function() {
        const s = window.__autoAcceptState || {};
        return {
            clicks: s.clicks || 0,
            blocked: s.blocked || 0,
            fileEdits: s.fileEdits || 0,
            terminalCommands: s.terminalCommands || 0
        };
    };

    window.__autoAcceptConsumeSummaryRequest = function() {
        const s = window.__autoAcceptState || {};
        if (!s.summaryRequestPending) return { requested: false };
        s.summaryRequestPending = false;
        return {
            requested: true,
            requestedAt: s.summaryRequestedAt || Date.now()
        };
    };

    window.__autoAcceptSetSummaryResult = function(payload) {
        const s = window.__autoAcceptState || {};
        const p = payload || {};
        if (p.status === 'loading') {
            setSummaryWidgetState({ status: 'loading' });
            return;
        }

        if (p.status === 'success') {
            s.lastSummary = String(p.summary || '');
            setSummaryWidgetState({
                status: 'success',
                summary: s.lastSummary
            });
            return;
        }

        if (p.status === 'error') {
            setSummaryWidgetState({
                status: 'error',
                error: String(p.error || 'Failed to generate summary.')
            });
            return;
        }

        setSummaryWidgetState({ status: 'idle' });
    };

    window.__autoAcceptGetVisibleConversationText = function(maxChars) {
        const cap = Number(maxChars) > 0 ? Number(maxChars) : 12000;
        return collectVisibleConversationText(cap);
    };

    window.__autoAcceptStart = function(config) {
        const state = window.__autoAcceptState;

        // Stop if already running
        if (state.isRunning) {
            log('Already running, stopping first...');
            window.__autoAcceptStop();
        }

        state.isRunning = true;
        state.sessionID++;
        state.mode = config.isBackgroundMode ? 'background' : 'simple';
        state.ide = (config.ide || 'cursor').toLowerCase();
        state.pollInterval = config.pollInterval || 1000;
        state.tabNames = [];
        state.completionStatus = {};
        state._noTabCycles = 0;
        state.summaryRequestPending = false;
        state.summaryRequestedAt = 0;
        state.userInteracting = false;
        if (state._userInteractingTimer) { clearTimeout(state._userInteractingTimer); state._userInteractingTimer = null; }

        // Pause clicking when user mousedowns anywhere in the IDE window
        if (state._onUserInteract) document.removeEventListener('mousedown', state._onUserInteract, true);
        const onUserInteract = () => {
            const s = window.__autoAcceptState;
            if (!s || !s.isRunning) return;
            s.userInteracting = true;
            if (s._userInteractingTimer) clearTimeout(s._userInteractingTimer);
            s._userInteractingTimer = setTimeout(() => { s.userInteracting = false; }, 1500);
        };
        state._onUserInteract = onUserInteract;
        document.addEventListener('mousedown', onUserInteract, true);

        // Apply banned commands if provided
        if (config.bannedCommands) {
            state.bannedCommands = Array.isArray(config.bannedCommands) ? config.bannedCommands : [];
            log(`Banned commands loaded: ${state.bannedCommands.length} patterns`);
        }

        log(`Starting ${state.mode} mode for ${state.ide} (interval=${state.pollInterval}ms)...`);

        // ALWAYS start clicking loop using configured poll interval
        state.clickInterval = setInterval(() => {
            if (state.isRunning) {
                clickAcceptButtons();
            }
        }, state.pollInterval);

        log(`Clicking loop started (${state.pollInterval}ms interval)`);

        // ONLY start tab cycling + overlay if background mode enabled
        if (config.isBackgroundMode) {
            dismountSummaryWidget();
            // Mount overlay immediately
            mountOverlay();

            // Start tab cycling loop after 1s delay
            // (let clicking loop stabilize first)
            const sessionID = state.sessionID;
            setTimeout(() => {
                if (state.isRunning && state.sessionID === sessionID) {
                    if (state.ide === 'cursor') {
                        cursorTabLoop(sessionID);
                    } else {
                        antigravityTabLoop(sessionID);
                    }
                }
            }, 1000);

            log('Background mode: overlay mounted, tab cycling starting in 1s');
        } else {
            dismountOverlay();
            mountSummaryWidget();
            setSummaryWidgetState({ status: 'idle' });
        }

        log('Active!');
    };

    window.__autoAcceptStop = function() {
        const state = window.__autoAcceptState;
        state.isRunning = false;

        if (state.clickInterval) {
            clearInterval(state.clickInterval);
            state.clickInterval = null;
        }

        if (state._onUserInteract) {
            document.removeEventListener('mousedown', state._onUserInteract, true);
            state._onUserInteract = null;
        }
        if (state._userInteractingTimer) {
            clearTimeout(state._userInteractingTimer);
            state._userInteractingTimer = null;
        }
        state.userInteracting = false;

        // Dismount overlay if it was mounted (safe to call even if no overlay)
        dismountOverlay();
        dismountSummaryWidget();

        log('Stopped');
    };

    // Compatibility placeholders for cdp-handler.js
    window.__autoAcceptSetFocusState = function() {};
    window.__autoAcceptUpdateBannedCommands = function(bannedList) {
        const state = window.__autoAcceptState;
        if (state) {
            state.bannedCommands = Array.isArray(bannedList) ? bannedList : [];
            log(`Banned commands updated: ${state.bannedCommands.length} patterns`);
        }
    };

    log('Ready');
})();
