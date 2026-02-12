// Selector Finder - Robust & Iframe Support
// Copy paste this entire file into the console

(function () {
    function getElementInfo(el) {
        return {
            tagName: el.tagName,
            id: el.id || '(none)',
            className: typeof el.className === 'string' ? el.className : '(svg/obj)',
            ariaLabel: el.getAttribute('aria-label') || '(none)',
            text: el.textContent?.trim().slice(0, 50) || '(none)',
            role: el.getAttribute('role') || '(none)',
            type: el.getAttribute('type') || '(none)'
        };
    }

    function generateSelector(el) {
        if (!el) return '';
        let selector = el.tagName.toLowerCase();
        if (el.id) return selector + '#' + el.id;

        if (typeof el.className === 'string' && el.className.trim()) {
            selector += '.' + el.className.split(/\s+/).filter(c => c).join('.');
        }

        // Add attributes for uniqueness if minimal
        ['name', 'role', 'aria-label', 'placeholder', 'data-testid'].forEach(attr => {
            if (el.hasAttribute(attr)) {
                selector += `[${attr}="${el.getAttribute(attr)}"]`;
            }
        });

        return selector;
    }

    function getFullPath(el) {
        let path = [];
        let current = el;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            path.unshift(generateSelector(current));
            current = current.parentElement;
        }
        return path.join(' > ');
    }

    function handleEvent(e, contextInfo) {
        e.preventDefault();
        e.stopPropagation();

        const el = e.target;
        const info = getElementInfo(el);

        console.log(`[Selector Finder] Element Clicked in [${contextInfo}]`);
        console.log('Basic Info:', info);
        console.log('CSS Selector:', generateSelector(el));
        console.log('Full Path:', getFullPath(el));

        const btn = el.closest('button, [role="button"], a');
        if (btn && btn !== el) {
            console.log('--- Parent Interactive Element ---');
            console.log('Parent Tag:', btn.tagName);
            console.log('Parent Selector:', generateSelector(btn));
        }
        console.log('----------------------------------------');
    }

    function attachListeners(doc, contextName, silent = false) {
        try {
            // Remove old listener if we attached one (requires tracking, skipping for now as this is usually one-off)
            doc.removeEventListener('click', doc._selectorFinderHandler, true);

            doc._selectorFinderHandler = (e) => handleEvent(e, contextName);
            doc.addEventListener('click', doc._selectorFinderHandler, true);
            if (!silent) console.log(`Attached to: ${contextName}`);

            // Recurse into iframes
            const iframes = doc.querySelectorAll('iframe, frame');
            iframes.forEach((iframe, idx) => {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (iframeDoc) {
                        attachListeners(iframeDoc, `${contextName} > Iframe[${idx}]`, silent);
                    }
                } catch (err) {
                    if (!silent) console.warn(`Cannot access iframe [${idx}] in ${contextName} (Cross-Origin)`);
                }
            });
        } catch (e) {
            console.error(`Error attaching to ${contextName}:`, e);
        }
    }

    console.clear();
    console.log('Selector Finder Activated - Click any element to inspect');
    attachListeners(document, 'Main Window');

    // Optional: Re-scan periodically for new iframes
    setInterval(() => {
        attachListeners(document, 'Main Window', true);
    }, 2000);

})();