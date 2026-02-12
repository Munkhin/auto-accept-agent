/**
 * 03_clicking.js — Button Clicking & Error Detection
 *
 * From background_loop_debug.js lines 88-184.
 * Plus banned command detection from the extension.
 */

// --- BANNED COMMAND DETECTION ---
function findNearbyCommandText(el) {
    let commandText = '';

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
            for (const selector of SELECTORS.commandElements) {
                const codeElements = sibling.querySelectorAll(selector);
                for (const codeEl of codeElements) {
                    if (codeEl?.textContent) {
                        const text = codeEl.textContent.trim();
                        if (text.length > 0 && text.length < 5000) commandText += ' ' + text;
                    }
                }
            }
            sibling = sibling.previousElementSibling;
            siblingCount++;
        }
        if (commandText.length > 10) break;
        container = container.parentElement;
        depth++;
    }

    if (commandText.length === 0) {
        let btnSibling = el.previousElementSibling;
        let count = 0;
        while (btnSibling && count < 3) {
            for (const selector of SELECTORS.commandElements) {
                const codeElements = btnSibling.querySelectorAll ? btnSibling.querySelectorAll(selector) : [];
                for (const codeEl of codeElements) {
                    if (codeEl?.textContent) commandText += ' ' + codeEl.textContent.trim();
                }
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
    const bannedList = window.__autoAcceptState.bannedCommands || [];
    if (bannedList.length === 0 || !commandText) return false;

    const lowerText = commandText.toLowerCase();

    for (const banned of bannedList) {
        const pattern = banned.trim();
        if (!pattern) continue;

        try {
            if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
                const lastSlash = pattern.lastIndexOf('/');
                const regex = new RegExp(pattern.substring(1, lastSlash), pattern.substring(lastSlash + 1) || 'i');
                if (regex.test(commandText)) {
                    log(`[BANNED] Blocked by regex: ${pattern}`);
                    window.__autoAcceptState.blocked++;
                    return true;
                }
            } else {
                if (lowerText.includes(pattern.toLowerCase())) {
                    log(`[BANNED] Blocked by pattern: "${pattern}"`);
                    window.__autoAcceptState.blocked++;
                    return true;
                }
            }
        } catch (e) {
            if (lowerText.includes(pattern.toLowerCase())) {
                log(`[BANNED] Blocked (fallback): "${pattern}"`);
                window.__autoAcceptState.blocked++;
                return true;
            }
        }
    }
    return false;
}

// --- BUTTON DETECTION ---
function isAcceptButton(el) {
    const text = (el.textContent || "").trim().toLowerCase();
    if (text.length === 0 || text.length > 50) return false;

    if (SELECTORS.rejectPatterns.some(r => text.includes(r))) return false;
    if (!SELECTORS.acceptPatterns.some(p => text.includes(p))) return false;

    // Check banned commands for run/execute buttons
    if (text.includes('run command') || text.includes('execute') || text.includes('run')) {
        const nearbyText = findNearbyCommandText(el);
        if (isCommandBanned(nearbyText)) return false;
    }

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
            if (!isElementVisible(el)) resolve(true);
            else if (Date.now() - startTime >= timeout) resolve(false);
            else requestAnimationFrame(check);
        };
        setTimeout(check, 50);
    });
}

async function performClick(selectors) {
    const found = [];
    selectors.forEach(s => queryAll(s).forEach(el => found.push(el)));
    const uniqueFound = [...new Set(found)];
    let clicked = 0;

    for (const el of uniqueFound) {
        if (isAcceptButton(el)) {
            const buttonText = (el.textContent || "").trim();
            log(`[CLICK] "${buttonText}"`);
            el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
            clicked++;

            const disappeared = await waitForDisappear(el);
            if (disappeared) {
                window.__autoAcceptState.clicks++;
                log(`[CLICK] Verified (disappeared). Total: ${window.__autoAcceptState.clicks}`);
            }
        }
    }
    return clicked;
}

// --- COMPILATION ERROR DETECTION ---
function hasCompilationErrors() {
    const errorBadges = queryAll(SELECTORS.errorBadges);
    for (const badge of errorBadges) {
        const text = (badge.textContent || '').trim();
        const num = parseInt(text, 10);
        if (!isNaN(num) && num > 0) {
            log(`[Compile] Found error badge with count: ${num}`);
            return true;
        }
    }

    const errorDecorations = queryAll(SELECTORS.errorSquiggles);
    if (errorDecorations.length > 0) {
        log(`[Compile] Found ${errorDecorations.length} error squiggles in editor`);
        return true;
    }

    const errorSpans = queryAll('span').filter(s => {
        const t = s.textContent.trim().toLowerCase();
        return SELECTORS.errorSpanTexts.includes(t);
    });
    if (errorSpans.length > 0) {
        log(`[Compile] Found error text spans: ${errorSpans.length}`);
        return true;
    }

    return false;
}
