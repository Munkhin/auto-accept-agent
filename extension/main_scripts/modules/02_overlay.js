/**
 * 02_overlay.js — Overlay System
 *
 * From overlay.js with CSS.escape bug fixed.
 * Provides mount/dismount, tab loading, completion marking.
 *
 * Overlay Events:
 *   Event 1: mount/dismount overlay (black screen over AI panel)
 *   Event 2: loadTabsOntoOverlay (progress bars for each conversation)
 *   Event 3: markTabCompleted (purple → green transition)
 *
 * States: IN PROGRESS (purple) | COMPLETED (green)
 */

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

/** EVENT 1: Mount overlay — covers AI panel only */
function mountOverlay() {
    if (document.getElementById(SELECTORS.overlayId)) {
        log('[FLOW] Overlay already mounted, skipping');
        return;
    }

    log('[FLOW] EVENT 1: Mounting overlay...');

    if (!document.getElementById(SELECTORS.overlayStyleId)) {
        const style = document.createElement('style');
        style.id = SELECTORS.overlayStyleId;
        style.textContent = OVERLAY_STYLES;
        document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.id = SELECTORS.overlayId;

    const container = document.createElement('div');
    container.className = 'aab-container';
    container.id = SELECTORS.overlayContainerId;

    overlay.appendChild(container);
    document.body.appendChild(overlay);

    // Find AI panel and position overlay
    let panel = null;
    for (const selector of SELECTORS.panels) {
        const found = queryAll(selector).find(p => p.offsetWidth > 50);
        if (found) {
            panel = found;
            log(`[FLOW] Overlay anchored to panel: ${selector}`);
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
    log('[FLOW] Overlay mounted (black screen visible)');
}

/** EVENT 1 (reverse): Dismount overlay */
function dismountOverlay() {
    const overlay = document.getElementById(SELECTORS.overlayId);
    if (!overlay) {
        log('[FLOW] Overlay not present, nothing to dismount');
        return;
    }

    log('[FLOW] Dismounting overlay...');
    if (overlay._resizeObserver) {
        overlay._resizeObserver.disconnect();
    }
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 300);
    log('[FLOW] Overlay dismounted');
}

/** EVENT 2: Load tab names as progress bars */
function loadTabsOntoOverlay(tabNames) {
    const container = document.getElementById(SELECTORS.overlayContainerId);
    if (!container) return;
    if (!tabNames || tabNames.length === 0) return;

    log(`[FLOW] EVENT 2: Loading ${tabNames.length} tabs onto overlay`);
    container.innerHTML = '';

    const completionStatus = window.__autoAcceptState?.completionStatus || {};

    tabNames.forEach(name => {
        const isCompleted = completionStatus[name] === 'done' || completionStatus[name] === true;
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

/**
 * EVENT 3: Mark a specific tab as completed
 * FIX: Uses DOM iteration instead of CSS.escape for attribute matching.
 * CSS.escape escapes for CSS identifiers, not attribute values,
 * so names like "Chat (2)" would fail to match.
 */
function markTabCompleted(tabName) {
    const container = document.getElementById(SELECTORS.overlayContainerId);
    if (!container) return;

    const slots = container.querySelectorAll('.aab-slot');
    for (const slot of slots) {
        if (slot.getAttribute('data-name') === tabName) {
            if (!slot.classList.contains('completed')) {
                log(`[FLOW] EVENT 3: Marking "${tabName}" as COMPLETED`);
                slot.classList.remove('in-progress');
                slot.classList.add('completed');
                const statusSpan = slot.querySelector('.aab-status');
                if (statusSpan) statusSpan.textContent = 'COMPLETED';
            }
            break;
        }
    }
}

/** Tab name management — updates state and overlay */
const updateTabNames = (tabs) => {
    const rawNames = Array.from(tabs).map(tab => stripTimeSuffix(tab.textContent));
    const tabNames = deduplicateNames(rawNames);

    if (tabNames.length === 0 && window.__autoAcceptState.tabNames?.length > 0) {
        return; // DOM refresh, keep previous
    }

    const previousNames = window.__autoAcceptState.tabNames || [];

    if (JSON.stringify(previousNames) !== JSON.stringify(tabNames)) {
        log(`[FLOW] Tab names changed: [${tabNames.join(', ')}]`);
        window.__autoAcceptState.tabNames = tabNames;

        if (tabNames.length >= 3) {
            loadTabsOntoOverlay(tabNames);
        }
    }
};

/** Completion state tracking — updates state and overlay */
const updateConversationCompletionState = (deduplicatedName, status) => {
    const current = window.__autoAcceptState.completionStatus[deduplicatedName];
    const normalizedStatus = (status === 'done' || status === 'done-errors' || status === true) ? 'done' : undefined;

    if (current !== normalizedStatus && normalizedStatus === 'done') {
        log(`[FLOW] Completion: "${deduplicatedName}" -> done`);
        window.__autoAcceptState.completionStatus[deduplicatedName] = 'done';
        markTabCompleted(deduplicatedName);
    }
};
