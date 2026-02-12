const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_PORT = 9000;
const PORT_RANGE = 3; // 9000 +/- 3

// Load the unified auto_accept.js script once
let _autoAcceptScript = null;
function getAutoAcceptScript() {
    if (_autoAcceptScript) return _autoAcceptScript;

    const candidates = [
        path.join(__dirname, 'auto_accept.js'),
        path.join(__dirname, '..', 'main_scripts', 'auto_accept.js')
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            _autoAcceptScript = fs.readFileSync(p, 'utf8');
            return _autoAcceptScript;
        }
    }

    throw new Error(`Could not find auto_accept.js. __dirname=${__dirname}`);
}

class CDPHandler {
    constructor(logger = console.log) {
        this.logger = logger;
        this.connections = new Map(); // port:pageId -> {ws, injected, mode}
        this.isEnabled = false;
        this.msgId = 1;
    }

    log(msg) {
        this.logger(`[CDP] ${msg}`);
    }

    async isCDPAvailable() {
        for (let port = BASE_PORT - PORT_RANGE; port <= BASE_PORT + PORT_RANGE; port++) {
            try {
                const pages = await this._getPages(port);
                if (pages.length > 0) return true;
            } catch (e) { }
        }
        return false;
    }

    async start(config) {
        this.isEnabled = true;
        this.log(`Scanning ports ${BASE_PORT - PORT_RANGE} to ${BASE_PORT + PORT_RANGE}...`);
        this.log(`Config: bg=${config.isBackgroundMode}, pro=${config.isPro}, ide=${config.ide}`);

        for (let port = BASE_PORT - PORT_RANGE; port <= BASE_PORT + PORT_RANGE; port++) {
            try {
                const pages = await this._getPages(port);
                if (pages.length > 0) {
                    this.log(`Port ${port}: Found ${pages.length} page(s):`);
                    pages.forEach((p, i) => this.log(`  [${i}] type=${p.type} title="${(p.title || '').substring(0, 50)}" url=${(p.url || '').substring(0, 80)}`));
                }
                for (const page of pages) {
                    const id = `${port}:${page.id}`;
                    if (!this.connections.has(id)) {
                        await this._connect(id, page.webSocketDebuggerUrl);
                    }
                    await this._inject(id, config);
                }
            } catch (e) { }
        }
    }

    async stop() {
        this.isEnabled = false;
        for (const [id, conn] of this.connections) {
            try {
                await this._evaluate(id, 'if(window.__autoAcceptStop) window.__autoAcceptStop()');
                conn.mode = null;
                conn.ws.close();
            } catch (e) { }
        }
        this.connections.clear();
    }

    async _getPages(port) {
        return new Promise((resolve, reject) => {
            const req = http.get({ hostname: '127.0.0.1', port, path: '/json/list', timeout: 500 }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const pages = JSON.parse(body);
                        const filtered = pages.filter(p => {
                            if (!p.webSocketDebuggerUrl) return false;
                            if (p.type !== 'page' && p.type !== 'webview') return false;
                            const url = (p.url || '').toLowerCase();
                            if (url.startsWith('devtools://') || url.startsWith('chrome-devtools://') || url.includes('devtools/devtools')) return false;
                            return true;
                        });
                        resolve(filtered);
                    } catch (e) { resolve([]); }
                });
            });
            req.on('error', () => resolve([]));
            req.on('timeout', () => { req.destroy(); resolve([]); });
        });
    }

    async _connect(id, url) {
        return new Promise((resolve) => {
            const ws = new WebSocket(url);
            ws.on('open', () => {
                this.connections.set(id, { ws, injected: false, mode: null });
                this.log(`Connected to page ${id}`);
                resolve(true);
            });
            ws.on('error', () => resolve(false));
            ws.on('close', () => {
                this.connections.delete(id);
                this.log(`Disconnected from page ${id}`);
            });
        });
    }

    async _inject(id, config) {
        const conn = this.connections.get(id);
        if (!conn) return;

        const mode = (config.isBackgroundMode && config.isPro) ? 'background' : 'simple';

        try {
            // Step 1: Inject script if not already injected
            if (!conn.injected) {
                const script = getAutoAcceptScript();
                this.log(`Injecting unified script into ${id} (${(script.length / 1024).toFixed(1)}KB)...`);
                await this._evaluate(id, script);
                conn.injected = true;
                this.log(`Script injected into ${id}`);
            }

            // Step 2: If mode changed, stop current mode first (this dismounts overlay too)
            if (conn.mode !== null && conn.mode !== mode) {
                this.log(`Mode changed from ${conn.mode} to ${mode} on ${id}, restarting...`);
                await this._evaluate(id, 'if(window.__autoAcceptStop) window.__autoAcceptStop()');
            }

            // Step 3: Start with current config (if mode changed or first time)
            if (conn.mode !== mode) {
                const configJson = JSON.stringify({
                    ide: config.ide,
                    isBackgroundMode: mode === 'background'
                });
                this.log(`Calling __autoAcceptStart on ${id} with ${configJson}`);
                await this._evaluate(id, `if(window.__autoAcceptStart) window.__autoAcceptStart(${configJson})`);
                conn.mode = mode;
            }
        } catch (e) {
            this.log(`Injection failed for ${id}: ${e.message}`);
        }
    }

    async _evaluate(id, expression) {
        const conn = this.connections.get(id);
        if (!conn || conn.ws.readyState !== WebSocket.OPEN) return;

        return new Promise((resolve, reject) => {
            const currentId = this.msgId++;
            const timeout = setTimeout(() => reject(new Error('CDP Timeout')), 2000);

            const onMessage = (data) => {
                const msg = JSON.parse(data.toString());
                if (msg.id === currentId) {
                    conn.ws.off('message', onMessage);
                    clearTimeout(timeout);
                    resolve(msg.result);
                }
            };

            conn.ws.on('message', onMessage);
            conn.ws.send(JSON.stringify({
                id: currentId,
                method: 'Runtime.evaluate',
                params: { expression, userGesture: true, awaitPromise: true }
            }));
        });
    }

    async getStats() {
        const stats = { clicks: 0, blocked: 0, fileEdits: 0, terminalCommands: 0 };
        for (const [id] of this.connections) {
            try {
                const res = await this._evaluate(id, 'JSON.stringify(window.__autoAcceptGetStats ? window.__autoAcceptGetStats() : {})');
                if (res?.result?.value) {
                    const s = JSON.parse(res.result.value);
                    stats.clicks += s.clicks || 0;
                    stats.blocked += s.blocked || 0;
                    stats.fileEdits += s.fileEdits || 0;
                    stats.terminalCommands += s.terminalCommands || 0;
                }
            } catch (e) { }
        }
        return stats;
    }

    async getSessionSummary() { return this.getStats(); }
    async setFocusState(isFocused) {
        for (const [id] of this.connections) {
            try {
                await this._evaluate(id, `if(window.__autoAcceptSetFocusState) window.__autoAcceptSetFocusState(${isFocused})`);
            } catch (e) { }
        }
    }

    getConnectionCount() { return this.connections.size; }
    async getAwayActions() { return 0; }
    async resetStats() { return { clicks: 0, blocked: 0 }; }
    async hideBackgroundOverlay() {
        for (const [id] of this.connections) {
            try {
                await this._evaluate(id, `
                    (function() {
                        var el = document.getElementById('__autoAcceptBgOverlay');
                        if (el) {
                            if (el._resizeObserver) el._resizeObserver.disconnect();
                            el.classList.remove('visible');
                            setTimeout(function() { el.remove(); }, 300);
                        }
                    })()
                `);
            } catch (e) { }
        }
    }
}

module.exports = { CDPHandler };
