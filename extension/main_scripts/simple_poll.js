// Simple static click loop for accept buttons
// Continuously finds and clicks accept buttons without tab switching

export async function simplePoll(interval = 300) {
    console.log('[SimplePoll] Starting static click loop...');

    while (true) {
        const clicked = await clickAcceptButtons();
        if (clicked > 0) {
            console.log(`[SimplePoll] Clicked ${clicked} button(s)`);
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
}

// Helper: Get all documents including iframes
function getDocuments(root = document) {
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
}

// Helper: Query all documents
function queryAll(selector) {
    const results = [];
    getDocuments().forEach(doc => {
        try {
            results.push(...Array.from(doc.querySelectorAll(selector)));
        } catch (e) { }
    });
    return results;
}

// Helper: Check if element is an accept button
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

// Main click function
async function clickAcceptButtons() {
    const selectors = [
        '.bg-ide-button-background',  // Antigravity IDE
        'button',
        '[class*="button"]',
        '[class*="anysphere"]'
    ];

    const found = [];
    selectors.forEach(s => queryAll(s).forEach(el => found.push(el)));

    let clicked = 0;
    const uniqueFound = [...new Set(found)];

    for (const el of uniqueFound) {
        if (isAcceptButton(el)) {
            const buttonText = (el.textContent || "").trim();
            console.log(`[SimplePoll] Clicking: "${buttonText}"`);

            el.dispatchEvent(new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true
            }));
            clicked++;
        }
    }

    return clicked;
}
