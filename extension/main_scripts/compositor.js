/**
 * compositor.js — Script Selector
 *
 * Returns the appropriate injection script based on config:
 *   - Background mode + Pro: full background loop with overlay
 *   - Otherwise: simple accept-button polling loop
 *
 * Usage:
 *   const { compose } = require('./compositor');
 *   const script = compose(config);
 */

const fs = require('fs');
const path = require('path');

let _bgCache = null;
let _bgCacheMtime = null;

function _findBgScript() {
    const candidates = [
        // Same directory as compositor.js (dev: main_scripts/)
        path.join(__dirname, 'background_mode.js'),
        // Up from dist/ into main_scripts/ (bundled context)
        path.join(__dirname, '..', 'main_scripts', 'background_mode.js'),
        // Up two levels from main_scripts/ (legacy)
        path.join(__dirname, '..', '..', 'main_scripts', 'background_mode.js'),
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }

    throw new Error(`Could not find background_mode.js. __dirname=${__dirname}, tried: ${candidates.join(', ')}`);
}

function _getBgScript() {
    const scriptPath = _findBgScript();
    const mtime = fs.statSync(scriptPath).mtimeMs;
    if (_bgCache && _bgCacheMtime === mtime) return _bgCache;
    _bgCache = fs.readFileSync(scriptPath, 'utf8');
    _bgCacheMtime = mtime;
    return _bgCache;
}

function _getSimplePollScript(config) {
    const interval = config.pollInterval || 2000;
    const ide = (config.ide || 'cursor').toLowerCase();

    const selectors = ide === 'antigravity'
        ? `['.bg-ide-button-background']`
        : `['button', '[class*="button"]', '[class*="anysphere"]']`;

    return `(function() {
    'use strict';
    if (typeof window === 'undefined') return;

    var _spLog = function(m) { console.log('[SimplePoll] ' + m); };

    if (window.__simplePollRunning) {
        _spLog('Already running, skipping re-inject');
        return;
    }

    var getDocuments = function(root) {
        root = root || document;
        var docs = [root];
        try {
            var iframes = root.querySelectorAll('iframe, frame');
            for (var i = 0; i < iframes.length; i++) {
                try {
                    var d = iframes[i].contentDocument || (iframes[i].contentWindow && iframes[i].contentWindow.document);
                    if (d) docs = docs.concat(getDocuments(d));
                } catch(e) {}
            }
        } catch(e) {}
        return docs;
    };

    var queryAll = function(selector) {
        var results = [];
        var docs = getDocuments();
        for (var i = 0; i < docs.length; i++) {
            try {
                var els = docs[i].querySelectorAll(selector);
                for (var j = 0; j < els.length; j++) results.push(els[j]);
            } catch(e) {}
        }
        return results;
    };

    var acceptPatterns = ['accept', 'run', 'retry', 'apply', 'execute', 'confirm', 'allow once', 'allow'];
    var rejectPatterns = ['skip', 'reject', 'cancel', 'close', 'refine'];

    var isAcceptButton = function(el) {
        var text = (el.textContent || '').trim().toLowerCase();
        if (text.length === 0 || text.length > 50) return false;
        var matched = false;
        for (var i = 0; i < rejectPatterns.length; i++) {
            if (text.indexOf(rejectPatterns[i]) !== -1) return false;
        }
        for (var i = 0; i < acceptPatterns.length; i++) {
            if (text.indexOf(acceptPatterns[i]) !== -1) { matched = true; break; }
        }
        if (!matched) return false;
        var style = window.getComputedStyle(el);
        var rect = el.getBoundingClientRect();
        return style.display !== 'none' && rect.width > 0 && style.pointerEvents !== 'none' && !el.disabled;
    };

    var selectors = ${selectors};
    var interval = ${interval};
    var stats = { clicks: 0, cycles: 0 };

    window.__autoAcceptGetStats = function() { return stats; };

    var poll = async function() {
        window.__simplePollRunning = true;
        _spLog('Started (ide=${ide}, interval=' + interval + 'ms)');

        while (window.__simplePollRunning) {
            stats.cycles++;
            var clicked = 0;
            for (var s = 0; s < selectors.length; s++) {
                var els = queryAll(selectors[s]);
                for (var e = 0; e < els.length; e++) {
                    if (isAcceptButton(els[e])) {
                        var btnText = (els[e].textContent || '').trim();
                        _spLog('Clicking: "' + btnText + '"');
                        els[e].dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                        clicked++;
                        stats.clicks++;
                    }
                }
            }
            if (clicked > 0) _spLog('Cycle ' + stats.cycles + ': clicked ' + clicked + ' button(s)');
            await new Promise(function(r) { setTimeout(r, interval); });
        }
        _spLog('Stopped');
    };

    window.stopSimplePoll = function() {
        window.__simplePollRunning = false;
        _spLog('Stop requested');
    };

    poll();
})();`;
}

function compose(config) {
    config = config || {};

    const useBackground = config.isBackgroundMode && config.isPro;
    console.log(`[Compositor] compose called: isBackgroundMode=${config.isBackgroundMode}, isPro=${config.isPro} → ${useBackground ? 'BACKGROUND' : 'SIMPLE POLL'}`);

    if (useBackground) {
        const script = _getBgScript();
        console.log(`[Compositor] Background script loaded (${(script.length / 1024).toFixed(1)}KB)`);
        return script;
    }

    console.log(`[Compositor] Returning simple poll (ide=${config.ide}, interval=${config.pollInterval})`);
    return _getSimplePollScript(config);
}

module.exports = { compose };
