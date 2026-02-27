var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// config.js
var require_config = __commonJS({
  "config.js"(exports2, module2) {
    module2.exports = {
      STRIPE_LINKS: {
        MONTHLY: "https://buy.stripe.com/14AcN52aJbu7gHBgRQ9MY0y",
        LIFETIME: "https://buy.stripe.com/3cI3cv5mVaq3crlfNM9MY0u"
      }
    };
  }
});

// settings-panel.js
var require_settings_panel = __commonJS({
  "settings-panel.js"(exports2, module2) {
    var vscode2 = require("vscode");
    var { STRIPE_LINKS } = require_config();
    var LICENSE_API2 = "https://auto-accept-backend.onrender.com/api";
    var SettingsPanel2 = class _SettingsPanel {
      static currentPanel = void 0;
      static viewType = "autoAcceptSettings";
      static createOrShow(extensionUri, context, mode = "settings") {
        const column = vscode2.window.activeTextEditor ? vscode2.window.activeTextEditor.viewColumn : void 0;
        if (_SettingsPanel.currentPanel) {
          _SettingsPanel.currentPanel.panel.reveal(column);
          _SettingsPanel.currentPanel.updateMode(mode);
          return;
        }
        const panel = vscode2.window.createWebviewPanel(
          _SettingsPanel.viewType,
          mode === "prompt" ? "Auto Accept Agent" : "Auto Accept Settings",
          column || vscode2.ViewColumn.One,
          {
            enableScripts: true,
            localResourceRoots: [vscode2.Uri.joinPath(extensionUri, "media")],
            retainContextWhenHidden: true
          }
        );
        _SettingsPanel.currentPanel = new _SettingsPanel(panel, extensionUri, context, mode);
      }
      static showUpgradePrompt(context, ide = "Antigravity") {
        if (_SettingsPanel.currentPanel) {
          _SettingsPanel.currentPanel.currentIDE = ide;
        }
        _SettingsPanel.createOrShow(context.extensionUri, context, "prompt");
      }
      constructor(panel, extensionUri, context, mode) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.context = context;
        this.mode = mode;
        this.currentIDE = "Antigravity";
        this.disposables = [];
        this.update();
        if (mode === "prompt") {
          this.startPolling(this.getUserId());
        }
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
          async (message) => {
            switch (message.command) {
              case "setFrequency":
                if (this.isPro()) {
                  await this.context.globalState.update("auto-accept-frequency", message.value);
                  vscode2.commands.executeCommand("auto-accept.updateFrequency", message.value);
                }
                break;
              case "getStats":
                this.sendStats();
                break;
              case "getROIStats":
                this.sendROIStats();
                break;
              case "updateBannedCommands":
                if (this.isPro()) {
                  await this.context.globalState.update("auto-accept-banned-commands", message.commands);
                  vscode2.commands.executeCommand("auto-accept.updateBannedCommands", message.commands);
                }
                break;
              case "getBannedCommands":
                this.sendBannedCommands();
                break;
              case "upgrade":
                this.openUpgrade(message.promoCode);
                this.startPolling(this.getUserId());
                break;
              case "checkPro":
                this.handleCheckPro();
                break;
              case "dismissPrompt":
                await this.handleDismiss();
                break;
              case "cancelSubscription":
                await this.handleCancelSubscription();
                break;
            }
          },
          null,
          this.disposables
        );
      }
      async handleDismiss() {
        const now = Date.now();
        await this.context.globalState.update("auto-accept-lastDismissedAt", now);
        this.dispose();
      }
      async handleCancelSubscription() {
        const userId = this.getUserId();
        vscode2.window.withProgress(
          {
            location: vscode2.ProgressLocation.Notification,
            title: "Processing cancellation request...",
            cancellable: false
          },
          async (progress) => {
            try {
              const https2 = require("https");
              const postData = JSON.stringify({ userId });
              const options = {
                hostname: "auto-accept-backend.onrender.com",
                path: "/api/cancel-subscription",
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(postData)
                }
              };
              const result = await new Promise((resolve, reject) => {
                const req = https2.request(options, (res) => {
                  let data = "";
                  res.on("data", (chunk) => data += chunk);
                  res.on("end", () => {
                    try {
                      resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
                    } catch (e) {
                      resolve({ statusCode: res.statusCode, data: {} });
                    }
                  });
                });
                req.on("error", reject);
                req.write(postData);
                req.end();
              });
              if (result.statusCode === 200) {
                vscode2.window.showInformationMessage(
                  "Subscription cancelled. You will retain Pro access until the end of your billing period.",
                  "OK"
                );
              } else {
                vscode2.window.showErrorMessage(
                  "Failed to cancel subscription. Please contact support or manage your subscription via Stripe customer portal.",
                  "Contact Support"
                ).then((selection) => {
                  if (selection === "Contact Support") {
                    vscode2.env.openExternal(vscode2.Uri.parse("https://github.com/MunKhin/auto-accept-agent/issues"));
                  }
                });
              }
            } catch (error) {
              vscode2.window.showErrorMessage(
                "Network error. Please try again or contact support.",
                "OK"
              );
            }
          }
        );
      }
      async handleCheckPro() {
        const result = await this.checkProStatus(this.getUserId());
        if (result === null) {
          vscode2.window.showWarningMessage("Unable to verify license. Please check your network connection.");
          return;
        }
        if (result) {
          await this.context.globalState.update("auto-accept-isPro", true);
          vscode2.window.showInformationMessage("Auto Accept: License verified!");
          vscode2.commands.executeCommand("auto-accept.onPaid");
          this.update();
        } else {
          await this.context.globalState.update("auto-accept-isPro", false);
          vscode2.window.showWarningMessage("License not found. Please purchase a license to use Auto Accept.");
          this.update();
        }
      }
      isPro() {
        return this.context.globalState.get("auto-accept-isPro", false);
      }
      isPlanRecurring() {
        const plan = this.context.globalState.get("auto-accept-plan", "lifetime");
        return plan === "monthly" || plan === "pro";
      }
      getUserId() {
        let userId = this.context.globalState.get("auto-accept-userId");
        if (!userId) {
          userId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === "x" ? r : r & 3 | 8;
            return v.toString(16);
          });
          this.context.globalState.update("auto-accept-userId", userId);
        }
        return userId;
      }
      openUpgrade(promoCode) {
      }
      updateMode(mode) {
        this.mode = mode;
        this.panel.title = mode === "prompt" ? "Auto Accept Agent" : "Auto Accept Settings";
        this.update();
      }
      sendStats() {
        const stats = this.context.globalState.get("auto-accept-stats", {
          clicks: 0,
          sessions: 0,
          lastSession: null
        });
        const isPro2 = this.isPro();
        const frequency = this.context.globalState.get("auto-accept-frequency", 1e3);
        this.panel.webview.postMessage({
          command: "updateStats",
          stats,
          frequency,
          isPro: isPro2
        });
      }
      async sendROIStats() {
        try {
          const roiStats = await vscode2.commands.executeCommand("auto-accept.getROIStats");
          this.panel.webview.postMessage({
            command: "updateROIStats",
            roiStats
          });
        } catch (e) {
        }
      }
      sendBannedCommands() {
        const defaultBannedCommands = [
          "rm -rf /",
          "rm -rf ~",
          "rm -rf *",
          "format c:",
          "del /f /s /q",
          "rmdir /s /q",
          ":(){:|:&};:",
          "dd if=",
          "mkfs.",
          "> /dev/sda",
          "chmod -R 777 /"
        ];
        const bannedCommands2 = this.context.globalState.get("auto-accept-banned-commands", defaultBannedCommands);
        this.panel.webview.postMessage({
          command: "updateBannedCommands",
          bannedCommands: bannedCommands2
        });
      }
      update() {
        this.panel.webview.html = this.getHtmlContent();
        setTimeout(() => {
          this.sendStats();
          this.sendROIStats();
        }, 100);
      }
      getHtmlContent() {
        const isPro2 = this.isPro();
        const isPrompt = this.mode === "prompt";
        const userId = this.getUserId();
        const stripeLinks = {
          MONTHLY: `${STRIPE_LINKS.MONTHLY}?client_reference_id=${userId}`,
          LIFETIME: `${STRIPE_LINKS.LIFETIME}?client_reference_id=${userId}`
        };
        const css = `
            :root {
                --bg: #0a0a0c;
                --card-bg: #121216;
                --border: rgba(147, 51, 234, 0.2);
                --border-hover: rgba(147, 51, 234, 0.4);
                --accent: #9333ea;
                --accent-soft: rgba(147, 51, 234, 0.1);
                --green: #22c55e;
                --green-soft: rgba(34, 197, 94, 0.1);
                --fg: #ffffff;
                --fg-dim: rgba(255, 255, 255, 0.6);
                --font: 'Segoe UI', system-ui, -apple-system, sans-serif;
            }

            body {
                font-family: var(--font);
                background: var(--bg);
                color: var(--fg);
                margin: 0;
                padding: 40px 20px;
                display: flex;
                flex-direction: column;
                align-items: center;
                min-height: 100vh;
            }

            .container {
                max-width: ${isPrompt ? "500px" : "640px"};
                width: 100%;
                display: flex;
                flex-direction: column;
                gap: 24px;
            }

            /* Header Section */
            .header {
                text-align: center;
                margin-bottom: 8px;
            }
            .header h1 {
                font-size: 32px;
                font-weight: 800;
                margin: 0;
                letter-spacing: -0.5px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
            }
            .pro-badge {
                background: var(--accent);
                color: white;
                font-size: 12px;
                padding: 4px 8px;
                border-radius: 4px;
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 1px;
                box-shadow: 0 0 15px rgba(147, 51, 234, 0.4);
                animation: pulse 2s infinite;
            }
            @keyframes pulse {
                0% { box-shadow: 0 0 0px rgba(147, 51, 234, 0.4); }
                50% { box-shadow: 0 0 20px rgba(147, 51, 234, 0.6); }
                100% { box-shadow: 0 0 0px rgba(147, 51, 234, 0.4); }
            }
            .subtitle {
                color: var(--fg-dim);
                font-size: 14px;
                margin-top: 8px;
            }

            /* Sections */
            .section {
                background: var(--card-bg);
                border: 1px solid var(--border);
                border-radius: 12px;
                padding: 24px;
                transition: border-color 0.3s ease;
            }
            .section:hover {
                border-color: var(--border-hover);
            }
            .section-label {
                color: var(--accent);
                font-size: 11px;
                font-weight: 800;
                letter-spacing: 1px;
                text-transform: uppercase;
                margin-bottom: 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            /* Impact Grid */
            .impact-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
            }
            .impact-card {
                background: rgba(0, 0, 0, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.03);
                border-radius: 10px;
                padding: 20px 12px;
                text-align: center;
                transition: transform 0.2s ease;
            }
            .impact-card:hover {
                transform: translateY(-2px);
            }
            .stat-val {
                font-size: 36px;
                font-weight: 800;
                line-height: 1;
                margin-bottom: 8px;
                font-variant-numeric: tabular-nums;
            }
            .stat-label {
                font-size: 11px;
                color: var(--fg-dim);
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            /* Inputs and Buttons */
            input[type="range"] {
                width: 100%;
                accent-color: var(--accent);
                height: 6px;
                border-radius: 3px;
                background: rgba(255,255,255,0.1);
            }
            textarea {
                width: 100%;
                min-height: 140px;
                background: rgba(0,0,0,0.3);
                border: 1px solid var(--border);
                border-radius: 8px;
                color: var(--fg);
                font-family: 'JetBrains Mono', 'Fira Code', monospace;
                font-size: 12px;
                padding: 12px;
                resize: vertical;
                outline: none;
            }
            textarea:focus { border-color: var(--accent); }

            .btn-primary {
                background: var(--accent);
                color: white;
                border: none;
                padding: 14px;
                border-radius: 8px;
                font-weight: 700;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                text-decoration: none;
            }
            .btn-primary:hover {
                filter: brightness(1.2);
                transform: scale(1.01);
            }
            .btn-outline {
                background: transparent;
                border: 1px solid var(--border);
                color: var(--fg);
                padding: 10px 16px;
                border-radius: 8px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .btn-outline:hover {
                background: var(--accent-soft);
                border-color: var(--accent);
            }

            .btn-danger {
                background: transparent;
                border: 1px solid rgba(239, 68, 68, 0.3);
                color: #ef4444;
                padding: 10px 16px;
                border-radius: 8px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
                width: 100%;
            }
            .btn-danger:hover {
                background: rgba(239, 68, 68, 0.1);
                border-color: #ef4444;
            }

            .link-secondary {
                color: var(--accent);
                cursor: pointer;
                text-decoration: none;
                font-size: 13px;
                display: block;
                text-align: center;
                margin-top: 16px;
            }
            .link-secondary:hover { text-decoration: underline; }

            .locked {
                opacity: 0.5;
                pointer-events: none;
                filter: grayscale(1);
            }
            .pro-tip {
                color: var(--accent);
                font-size: 11px;
                margin-top: 12px;
                font-weight: 600;
            }

            .prompt-card {
                background: var(--card-bg);
                border: 1px solid var(--border);
                border-radius: 12px;
                padding: 32px;
                text-align: center;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            }
            .prompt-title { font-size: 20px; font-weight: 800; margin-bottom: 12px; letter-spacing: -0.5px; }
            .prompt-text { font-size: 15px; color: var(--fg-dim); line-height: 1.6; margin-bottom: 24px; }
        `;
        if (isPrompt) {
          const ideName = this.currentIDE || "Antigravity";
          return `<!DOCTYPE html>
            <html>
            <head><style>${css}</style></head>
            <body>
                <div class="container" style="display: flex; align-items: center; justify-content: center; min-height: 100vh;">
                    <div class="prompt-card">
                        <div style="font-size: 32px; margin-bottom: 20px;">\u{1F511}</div>
                        <div class="prompt-title">License Required</div>
                        <div class="prompt-text">
                            Auto Accept requires an active license.<br/><br/>
                            <strong style="color: var(--accent); opacity: 1;">Purchase a license to automate your ${ideName} agents.</strong>
                        </div>
                        <a href="${stripeLinks.MONTHLY}" class="btn-primary" style="margin-bottom: 12px;">
                            Monthly \u2014 $5/mo
                        </a>
                        <a href="${stripeLinks.LIFETIME}" class="btn-primary" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);">
                            Lifetime \u2014 $29 one-time
                        </a>
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    function dismiss() {
                        vscode.postMessage({ command: 'dismissPrompt' });
                    }
                </script>
            </body>
            </html>`;
        }
        return `<!DOCTYPE html>
        <html>
        <head><style>${css}</style></head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Auto Accept <span class="pro-badge">Pro</span></h1>
                    <div class="subtitle">Multi-agent automation for Antigravity & Cursor</div>
                </div>

                ${!isPro2 ? `
                <div class="section" style="background: var(--accent-soft); border-color: var(--accent); position: relative; overflow: hidden;">
                    <div class="section-label" style="color: white; margin-bottom: 12px; font-size: 14px;">\u{1F511} License Required</div>
                    <div style="font-size: 14px; line-height: 1.6; margin-bottom: 24px; color: rgba(255,255,255,0.9);">
                        Purchase a license to use Auto Accept.
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <a href="${stripeLinks.MONTHLY}" class="btn-primary">
                            $5 / Month
                        </a>
                        <a href="${stripeLinks.LIFETIME}" class="btn-primary" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);">
                            $29 Lifetime
                        </a>
                    </div>
                </div>
                ` : ""}

                <div class="section" id="performanceSection">
                    <div class="section-label">
                        <span>\u26A1 Performance Mode</span>
                        <span class="val-display" id="freqVal" style="color: var(--accent);">...</span>
                    </div>
                    <div>
                        <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 12px; opacity: 0.5;">Instant</span>
                            <div style="flex: 1;"><input type="range" id="freqSlider" min="200" max="3000" step="100" value="1000"></div>
                            <span style="font-size: 12px; opacity: 0.5;">Battery Saving</span>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-label">\u{1F6E1}\uFE0F Safety Rules</div>
                    <div style="font-size: 13px; opacity: 0.6; margin-bottom: 16px; line-height: 1.5;">
                        Patterns that will NEVER be auto-accepted.
                    </div>
                    <textarea id="bannedCommandsInput" 
                        placeholder="rm -rf /&#10;format c:&#10;del /f /s /q"
                        ${!isPro2 ? "readonly" : ""}></textarea>
                    
                    <div class="${!isPro2 ? "locked" : ""}" style="display: flex; gap: 12px; margin-top: 20px;">
                        <button id="saveBannedBtn" class="btn-primary" style="flex: 2;">
                            Update Rules
                        </button>
                        <button id="resetBannedBtn" class="btn-outline" style="flex: 1;">
                            Reset
                        </button>
                    </div>
                    <div id="bannedStatus" style="font-size: 12px; margin-top: 12px; text-align: center; height: 18px;"></div>
                </div>

                ${isPro2 && this.isPlanRecurring() ? `
                <div class="section">
                    <div class="section-label">\u{1F4B3} SUBSCRIPTION</div>
                    <div style="font-size: 13px; opacity: 0.6; margin-bottom: 16px; line-height: 1.5;">
                        Manage your Auto Accept Pro subscription
                    </div>
                    <button id="cancelSubBtn" class="btn-danger">
                        Cancel Subscription
                    </button>
                    <div id="cancelStatus" style="font-size: 12px; margin-top: 12px; text-align: center; height: 18px;"></div>
                </div>
                ` : ""}

                <div style="text-align: center; opacity: 0.15; font-size: 10px; padding: 20px 0; letter-spacing: 1px;">
                    REF: ${userId}
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                
                // --- Polling Logic for Real-time Refresh ---
                function refreshStats() {
                    vscode.postMessage({ command: 'getStats' });
                    vscode.postMessage({ command: 'getROIStats' });
                }
                
                // Refresh every 5 seconds while panel is open
                const refreshInterval = setInterval(refreshStats, 5000);
                
                // --- Event Listeners ---
                const slider = document.getElementById('freqSlider');
                const valDisplay = document.getElementById('freqVal');
                
                if (slider) {
                    slider.addEventListener('input', (e) => {
                         const s = (e.target.value/1000).toFixed(1) + 's';
                         valDisplay.innerText = s;
                         vscode.postMessage({ command: 'setFrequency', value: e.target.value });
                    });
                }

                const bannedInput = document.getElementById('bannedCommandsInput');
                const saveBannedBtn = document.getElementById('saveBannedBtn');
                const resetBannedBtn = document.getElementById('resetBannedBtn');
                const bannedStatus = document.getElementById('bannedStatus');

                const defaultBannedCommands = ["rm -rf /", "rm -rf ~", "rm -rf *", "format c:", "del /f /s /q", "rmdir /s /q", ":(){:|:&};:", "dd if=", "mkfs.", "> /dev/sda", "chmod -R 777 /"];

                if (saveBannedBtn) {
                    saveBannedBtn.addEventListener('click', () => {
                        const lines = bannedInput.value.split('\\n').map(l => l.trim()).filter(l => l.length > 0);
                        vscode.postMessage({ command: 'updateBannedCommands', commands: lines });
                        bannedStatus.innerText = '\u2713 Safety Rules Updated';
                        bannedStatus.style.color = 'var(--green)';
                        setTimeout(() => { bannedStatus.innerText = ''; }, 3000);
                    });
                }

                if (resetBannedBtn) {
                    resetBannedBtn.addEventListener('click', () => {
                        bannedInput.value = defaultBannedCommands.join('\\n');
                        vscode.postMessage({ command: 'updateBannedCommands', commands: defaultBannedCommands });
                        bannedStatus.innerText = '\u2713 Defaults Restored';
                        bannedStatus.style.color = 'var(--accent)';
                        setTimeout(() => { bannedStatus.innerText = ''; }, 3000);
                    });
                }

                const cancelSubBtn = document.getElementById('cancelSubBtn');
                const cancelStatus = document.getElementById('cancelStatus');

                if (cancelSubBtn) {
                    cancelSubBtn.addEventListener('click', () => {
                        if (confirm('Are you sure you want to cancel your Pro subscription? You will lose access to Pro features at the end of your billing period.')) {
                            vscode.postMessage({ command: 'cancelSubscription' });
                        }
                    });
                }

                // --- Fancy Count-up Animation ---
                function animateCountUp(element, target, duration = 1200, suffix = '') {
                    const currentVal = parseInt(element.innerText.replace(/[^0-9]/g, '')) || 0;
                    if (currentVal === target && !suffix) return;
                    
                    const startTime = performance.now();
                    function easeOutExpo(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }
                    
                    function update(currentTime) {
                        const elapsed = currentTime - startTime;
                        const progress = Math.min(elapsed / duration, 1);
                        const current = Math.round(currentVal + (target - currentVal) * easeOutExpo(progress));
                        element.innerText = current + suffix;
                        if (progress < 1) requestAnimationFrame(update);
                    }
                    requestAnimationFrame(update);
                }
                
                window.addEventListener('message', e => {
                    const msg = e.data;
                    if (msg.command === 'updateStats') {
                        if (slider && !${!isPro2}) {
                            slider.value = msg.frequency;
                            valDisplay.innerText = (msg.frequency/1000).toFixed(1) + 's';
                        }
                    }
                    if (msg.command === 'updateROIStats') {
                        const roi = msg.roiStats;
                        if (roi) {
                            animateCountUp(document.getElementById('roiClickCount'), roi.clicksThisWeek || 0);
                            animateCountUp(document.getElementById('roiSessionCount'), roi.sessionsThisWeek || 0);
                            animateCountUp(document.getElementById('roiBlockedCount'), roi.blockedThisWeek || 0);
                            document.getElementById('roiTimeSaved').innerText = roi.timeSavedFormatted || '0m';
                        }
                    }
                    if (msg.command === 'updateBannedCommands') {
                        if (bannedInput && msg.bannedCommands) {
                            bannedInput.value = msg.bannedCommands.join('\\n');
                        }
                    }
                });

                // Initial load
                refreshStats();
                vscode.postMessage({ command: 'getBannedCommands' });
            </script>
        </body>
        </html>`;
      }
      dispose() {
        _SettingsPanel.currentPanel = void 0;
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.panel.dispose();
        while (this.disposables.length) {
          const d = this.disposables.pop();
          if (d) d.dispose();
        }
      }
      async checkProStatus(userId) {
        return new Promise((resolve) => {
          const https2 = require("https");
          https2.get(`${LICENSE_API2}/verify?userId=${userId}`, (res) => {
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
              try {
                const json = JSON.parse(data);
                if (json.plan) {
                  this.context.globalState.update("auto-accept-plan", json.plan);
                }
                resolve(json.isPro === true);
              } catch (e) {
                resolve(null);
              }
            });
          }).on("error", () => resolve(null));
        });
      }
      startPolling(userId) {
        let attempts = 0;
        const maxAttempts = 60;
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = setInterval(async () => {
          attempts++;
          if (attempts > maxAttempts) {
            clearInterval(this.pollTimer);
            return;
          }
          const result = await this.checkProStatus(userId);
          if (result === null) return;
          if (result) {
            clearInterval(this.pollTimer);
            await this.context.globalState.update("auto-accept-isPro", true);
            vscode2.window.showInformationMessage("Auto Accept: License verified! Thank you for your support.");
            this.update();
            vscode2.commands.executeCommand("auto-accept.updateFrequency", 1e3);
            vscode2.commands.executeCommand("auto-accept.onPaid");
          }
        }, 5e3);
      }
    };
    module2.exports = { SettingsPanel: SettingsPanel2 };
  }
});

// node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "node_modules/ws/lib/constants.js"(exports2, module2) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module2.exports = {
      BINARY_TYPES,
      CLOSE_TIMEOUT: 3e4,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: /* @__PURE__ */ Symbol("kIsForOnEventAttribute"),
      kListener: /* @__PURE__ */ Symbol("kListener"),
      kStatusCode: /* @__PURE__ */ Symbol("status-code"),
      kWebSocket: /* @__PURE__ */ Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "node_modules/ws/lib/buffer-util.js"(exports2, module2) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module2.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = require("bufferutil");
        module2.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module2.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "node_modules/ws/lib/limiter.js"(exports2, module2) {
    "use strict";
    var kDone = /* @__PURE__ */ Symbol("kDone");
    var kRun = /* @__PURE__ */ Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module2.exports = Limiter;
  }
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "node_modules/ws/lib/permessage-deflate.js"(exports2, module2) {
    "use strict";
    var zlib = require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = /* @__PURE__ */ Symbol("permessage-deflate");
    var kTotalLength = /* @__PURE__ */ Symbol("total-length");
    var kCallback = /* @__PURE__ */ Symbol("callback");
    var kBuffers = /* @__PURE__ */ Symbol("buffers");
    var kError = /* @__PURE__ */ Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       * @param {Boolean} [isServer=false] Create the instance in either server or
       *     client mode
       * @param {Number} [maxPayload=0] The maximum allowed message length
       */
      constructor(options, isServer, maxPayload) {
        this._maxPayload = maxPayload | 0;
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._isServer = !!isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module2.exports = PerMessageDeflate;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "node_modules/ws/lib/validation.js"(exports2, module2) {
    "use strict";
    var { isUtf8 } = require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module2.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module2.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = require("utf-8-validate");
        module2.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "node_modules/ws/lib/receiver.js"(exports2, module2) {
    "use strict";
    var { Writable } = require("stream");
    var PerMessageDeflate = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module2.exports = Receiver;
  }
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "node_modules/ws/lib/sender.js"(exports2, module2) {
    "use strict";
    var { Duplex } = require("stream");
    var { randomFillSync } = require("crypto");
    var PerMessageDeflate = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = /* @__PURE__ */ Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else {
            buf.set(data, 2);
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module2.exports = Sender;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "node_modules/ws/lib/event-target.js"(exports2, module2) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = /* @__PURE__ */ Symbol("kCode");
    var kData = /* @__PURE__ */ Symbol("kData");
    var kError = /* @__PURE__ */ Symbol("kError");
    var kMessage = /* @__PURE__ */ Symbol("kMessage");
    var kReason = /* @__PURE__ */ Symbol("kReason");
    var kTarget = /* @__PURE__ */ Symbol("kTarget");
    var kType = /* @__PURE__ */ Symbol("kType");
    var kWasClean = /* @__PURE__ */ Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module2.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "node_modules/ws/lib/extension.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension) => {
        let configurations = extensions[extension];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module2.exports = { format, parse };
  }
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "node_modules/ws/lib/websocket.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var https2 = require("https");
    var http = require("http");
    var net = require("net");
    var tls = require("tls");
    var { randomBytes, createHash } = require("crypto");
    var { Duplex, Readable } = require("stream");
    var { URL } = require("url");
    var PerMessageDeflate = require_permessage_deflate();
    var Receiver = require_receiver();
    var Sender = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      CLOSE_TIMEOUT,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var kAborted = /* @__PURE__ */ Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            protocols = [];
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              protocols = [];
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._closeTimeout = options.closeTimeout;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate.extensionName]) {
          this._extensions[PerMessageDeflate.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._readyState = _WebSocket.CLOSING;
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket.prototype.addEventListener = addEventListener;
    WebSocket.prototype.removeEventListener = removeEventListener;
    module2.exports = WebSocket;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        closeTimeout: CLOSE_TIMEOUT,
        protocolVersion: protocolVersions[1],
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      websocket._closeTimeout = opts.closeTimeout;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL(address);
        } catch (e) {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes(16).toString("base64");
      const request = isSecure ? https2.request : http.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate(
          opts.perMessageDeflate !== true ? opts.perMessageDeflate : {},
          false,
          opts.maxPayload
        );
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket.CLOSED) return;
      if (websocket.readyState === WebSocket.OPEN) {
        websocket._readyState = WebSocket.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        websocket._closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket.CLOSING;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
        const chunk = this.read(this._readableState.length);
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket.CLOSING;
        this.destroy();
      }
    }
  }
});

// node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "node_modules/ws/lib/stream.js"(exports2, module2) {
    "use strict";
    var WebSocket = require_websocket();
    var { Duplex } = require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module2.exports = createWebSocketStream;
  }
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "node_modules/ws/lib/subprotocol.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module2.exports = { parse };
  }
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "node_modules/ws/lib/websocket-server.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var http = require("http");
    var { Duplex } = require("stream");
    var { createHash } = require("crypto");
    var extension = require_extension();
    var PerMessageDeflate = require_permessage_deflate();
    var subprotocol = require_subprotocol();
    var WebSocket = require_websocket();
    var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
       *     wait for the closing handshake to finish after `websocket.close()` is
       *     called
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          closeTimeout: CLOSE_TIMEOUT,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http.createServer((req, res) => {
            const body = http.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate(
            this.options.perMessageDeflate,
            true,
            this.options.maxPayload
          );
          try {
            const offers = extension.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
              extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate.extensionName]) {
          const params = extensions[PerMessageDeflate.extensionName].params;
          const value = extension.format({
            [PerMessageDeflate.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module2.exports = WebSocketServer;
    function addListeners(server, map) {
      for (const event of Object.keys(map)) server.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server) {
      server._state = CLOSED;
      server.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server, req, socket, code, message, headers) {
      if (server.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// node_modules/ws/index.js
var require_ws = __commonJS({
  "node_modules/ws/index.js"(exports2, module2) {
    "use strict";
    var WebSocket = require_websocket();
    WebSocket.createWebSocketStream = require_stream();
    WebSocket.Server = require_websocket_server();
    WebSocket.Receiver = require_receiver();
    WebSocket.Sender = require_sender();
    WebSocket.WebSocket = WebSocket;
    WebSocket.WebSocketServer = WebSocket.Server;
    module2.exports = WebSocket;
  }
});

// main_scripts/cdp-handler.js
var require_cdp_handler = __commonJS({
  "main_scripts/cdp-handler.js"(exports2, module2) {
    var WebSocket = require_ws();
    var http = require("http");
    var fs = require("fs");
    var path2 = require("path");
    var BASE_PORT = 9e3;
    var PORT_RANGE = 3;
    var _autoAcceptScript = null;
    function getAutoAcceptScript() {
      if (_autoAcceptScript) return _autoAcceptScript;
      const candidates = [
        path2.join(__dirname, "auto_accept.js"),
        path2.join(__dirname, "..", "main_scripts", "auto_accept.js")
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          _autoAcceptScript = fs.readFileSync(p, "utf8");
          return _autoAcceptScript;
        }
      }
      throw new Error(`Could not find auto_accept.js. __dirname=${__dirname}`);
    }
    var CDPHandler = class {
      constructor(logger = console.log) {
        this.logger = logger;
        this.connections = /* @__PURE__ */ new Map();
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
          } catch (e) {
          }
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
              pages.forEach((p, i) => this.log(`  [${i}] type=${p.type} title="${(p.title || "").substring(0, 50)}" url=${(p.url || "").substring(0, 80)}`));
            }
            for (const page of pages) {
              const id = `${port}:${page.id}`;
              if (!this.connections.has(id)) {
                await this._connect(id, page.webSocketDebuggerUrl);
              }
              await this._inject(id, config);
            }
          } catch (e) {
          }
        }
      }
      async stop() {
        this.isEnabled = false;
        for (const [id, conn] of this.connections) {
          try {
            await this._evaluate(id, "if(window.__autoAcceptStop) window.__autoAcceptStop()");
            conn.mode = null;
            conn.ws.close();
          } catch (e) {
          }
        }
        this.connections.clear();
      }
      async _getPages(port) {
        return new Promise((resolve, reject) => {
          const req = http.get({ hostname: "127.0.0.1", port, path: "/json/list", timeout: 500 }, (res) => {
            let body = "";
            res.on("data", (chunk) => body += chunk);
            res.on("end", () => {
              try {
                const pages = JSON.parse(body);
                const filtered = pages.filter((p) => {
                  if (!p.webSocketDebuggerUrl) return false;
                  if (p.type !== "page" && p.type !== "webview") return false;
                  const url = (p.url || "").toLowerCase();
                  if (url.startsWith("devtools://") || url.startsWith("chrome-devtools://") || url.includes("devtools/devtools")) return false;
                  return true;
                });
                resolve(filtered);
              } catch (e) {
                resolve([]);
              }
            });
          });
          req.on("error", () => resolve([]));
          req.on("timeout", () => {
            req.destroy();
            resolve([]);
          });
        });
      }
      async _connect(id, url) {
        return new Promise((resolve) => {
          const ws = new WebSocket(url);
          ws.on("open", () => {
            this.connections.set(id, { ws, injected: false, mode: null });
            this.log(`Connected to page ${id}`);
            resolve(true);
          });
          ws.on("error", () => resolve(false));
          ws.on("close", () => {
            this.connections.delete(id);
            this.log(`Disconnected from page ${id}`);
          });
        });
      }
      async _inject(id, config) {
        const conn = this.connections.get(id);
        if (!conn) return;
        const mode = config.isBackgroundMode ? "background" : "simple";
        try {
          if (!conn.injected) {
            const script = getAutoAcceptScript();
            this.log(`Injecting unified script into ${id} (${(script.length / 1024).toFixed(1)}KB)...`);
            await this._evaluate(id, script);
            conn.injected = true;
            this.log(`Script injected into ${id}`);
          }
          if (conn.mode !== null && conn.mode !== mode) {
            this.log(`Mode changed from ${conn.mode} to ${mode} on ${id}, restarting...`);
            await this._evaluate(id, "if(window.__autoAcceptStop) window.__autoAcceptStop()");
          }
          if (conn.mode !== mode) {
            const configJson = JSON.stringify({
              ide: config.ide,
              isBackgroundMode: mode === "background",
              pollInterval: config.pollInterval || 1e3,
              bannedCommands: config.bannedCommands || []
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
          const timeout = setTimeout(() => reject(new Error("CDP Timeout")), 2e3);
          const onMessage = (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.id === currentId) {
              conn.ws.off("message", onMessage);
              clearTimeout(timeout);
              resolve(msg.result);
            }
          };
          conn.ws.on("message", onMessage);
          conn.ws.send(JSON.stringify({
            id: currentId,
            method: "Runtime.evaluate",
            params: { expression, userGesture: true, awaitPromise: true }
          }));
        });
      }
      _parseJsonResult(res, fallback = null) {
        const value = res?.result?.value;
        if (typeof value !== "string") return fallback;
        try {
          return JSON.parse(value);
        } catch (e) {
          return fallback;
        }
      }
      async getStats() {
        const stats = { clicks: 0, blocked: 0, fileEdits: 0, terminalCommands: 0 };
        for (const [id] of this.connections) {
          try {
            const res = await this._evaluate(id, "JSON.stringify(window.__autoAcceptGetStats ? window.__autoAcceptGetStats() : {})");
            if (res?.result?.value) {
              const s = JSON.parse(res.result.value);
              stats.clicks += s.clicks || 0;
              stats.blocked += s.blocked || 0;
              stats.fileEdits += s.fileEdits || 0;
              stats.terminalCommands += s.terminalCommands || 0;
            }
          } catch (e) {
          }
        }
        return stats;
      }
      async getSessionSummary() {
        return this.getStats();
      }
      async consumeSummaryRequests() {
        const requests = [];
        for (const [id] of this.connections) {
          try {
            const res = await this._evaluate(id, "JSON.stringify(window.__autoAcceptConsumeSummaryRequest ? window.__autoAcceptConsumeSummaryRequest() : { requested: false })");
            const payload = this._parseJsonResult(res, { requested: false });
            if (payload && payload.requested) {
              requests.push({
                id,
                requestedAt: payload.requestedAt || Date.now()
              });
            }
          } catch (e) {
          }
        }
        return requests;
      }
      async getVisibleConversationText(preferredId = null, maxChars = 12e3) {
        const ids = [];
        if (preferredId && this.connections.has(preferredId)) {
          ids.push(preferredId);
        }
        for (const id of this.connections.keys()) {
          if (id !== preferredId) ids.push(id);
        }
        let best = "";
        for (const id of ids) {
          try {
            const res = await this._evaluate(id, `JSON.stringify(window.__autoAcceptGetVisibleConversationText ? window.__autoAcceptGetVisibleConversationText(${maxChars}) : "")`);
            const text = this._parseJsonResult(res, "");
            if (typeof text === "string" && text.trim().length > best.length) {
              best = text.trim();
            }
            if (best.length >= maxChars) break;
          } catch (e) {
          }
        }
        return best;
      }
      async pushSummaryResult(pageId, payload) {
        const expression = `if(window.__autoAcceptSetSummaryResult) window.__autoAcceptSetSummaryResult(${JSON.stringify(payload || {})})`;
        const ids = pageId && this.connections.has(pageId) ? [pageId] : Array.from(this.connections.keys());
        for (const id of ids) {
          try {
            await this._evaluate(id, expression);
          } catch (e) {
          }
        }
      }
      async setFocusState(isFocused) {
        for (const [id] of this.connections) {
          try {
            await this._evaluate(id, `if(window.__autoAcceptSetFocusState) window.__autoAcceptSetFocusState(${isFocused})`);
          } catch (e) {
          }
        }
      }
      getConnectionCount() {
        return this.connections.size;
      }
      async getAwayActions() {
        return 0;
      }
      async resetStats() {
        return { clicks: 0, blocked: 0 };
      }
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
          } catch (e) {
          }
        }
      }
    };
    module2.exports = { CDPHandler };
  }
});

// setup-panel.js
var require_setup_panel = __commonJS({
  "setup-panel.js"(exports2) {
    var vscode2 = require("vscode");
    var SetupPanel = class _SetupPanel {
      static currentPanel = void 0;
      static createOrShow(extensionUri, script, platform, ideName) {
        const column = vscode2.ViewColumn.One;
        if (_SetupPanel.currentPanel) {
          _SetupPanel.currentPanel._panel.reveal(column);
          _SetupPanel.currentPanel._update(script, platform, ideName);
          return;
        }
        const panel = vscode2.window.createWebviewPanel(
          "autoAcceptSetup",
          "Auto Accept Setup",
          column,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode2.Uri.joinPath(extensionUri, "media"), extensionUri]
          }
        );
        _SetupPanel.currentPanel = new _SetupPanel(panel, extensionUri, script, platform, ideName);
      }
      constructor(panel, extensionUri, script, platform, ideName) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._script = script;
        this._platform = platform;
        this._ideName = ideName;
        this._disposables = [];
        this._update(script, platform, ideName);
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
          (message) => {
            switch (message.command) {
              case "copyScript":
                vscode2.env.clipboard.writeText(this._script);
                vscode2.window.showInformationMessage("\u2705 Script copied to clipboard!");
                return;
              case "openHelp":
                vscode2.env.openExternal(vscode2.Uri.parse("https://github.com/MunKhin/auto-accept-agent/blob/master/SETUP_GUIDE.md"));
                return;
            }
          },
          null,
          this._disposables
        );
      }
      _update(script, platform, ideName) {
        this._script = script;
        this._platform = platform;
        this._ideName = ideName;
        this._panel.webview.html = this._getHtmlContent(script, platform, ideName);
      }
      _getHtmlContent(script, platform, ideName) {
        const terminalName = platform === "win32" ? "PowerShell (as Administrator)" : "Terminal";
        const iconUri = this._panel.webview.asWebviewUri(
          vscode2.Uri.joinPath(this._extensionUri, "media", "icon.png")
        );
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Auto Accept Setup</title>
    <style>
        :root {
            --bg: #0a0a0c;
            --card-bg: #121216;
            --border: rgba(147, 51, 234, 0.2);
            --border-hover: rgba(147, 51, 234, 0.4);
            --accent: #9333ea;
            --accent-soft: rgba(147, 51, 234, 0.1);
            --fg: #ffffff;
            --fg-dim: rgba(255, 255, 255, 0.6);
            --font: 'Segoe UI', system-ui, -apple-system, sans-serif;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--font);
            background: var(--bg);
            color: var(--fg);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
        }

        .container {
            max-width: 500px;
            width: 100%;
        }

        .header {
            text-align: center;
            margin-bottom: 32px;
        }

        .icon-img {
            width: 64px;
            height: 64px;
            margin-bottom: 16px;
        }

        .header h1 {
            font-size: 32px;
            font-weight: 800;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
        }

        .subtitle {
            color: var(--fg-dim);
            font-size: 14px;
        }

        .section {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 16px;
            transition: border-color 0.3s ease;
        }

        .section:hover {
            border-color: var(--border-hover);
        }

        .step {
            display: flex;
            align-items: start;
            gap: 16px;
            margin-bottom: 20px;
        }

        .step:last-child {
            margin-bottom: 0;
        }

        .step-number {
            background: var(--accent);
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 800;
            flex-shrink: 0;
            font-size: 16px;
        }

        .step-content {
            flex: 1;
            padding-top: 2px;
        }

        .step-title {
            font-weight: 600;
            margin-bottom: 4px;
            font-size: 15px;
        }

        .step-description {
            color: var(--fg-dim);
            font-size: 13px;
            line-height: 1.5;
        }

        .btn-copy {
            width: 100%;
            padding: 16px;
            background: var(--accent);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-top: 8px;
        }

        .btn-copy:hover {
            background: #a855f7;
            transform: translateY(-1px);
        }

        .btn-copy:active {
            transform: translateY(0);
        }

        .warning {
            background: var(--accent-soft);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 12px 16px;
            font-size: 13px;
            color: var(--fg-dim);
            line-height: 1.5;
        }

        .warning strong {
            color: var(--fg);
            display: block;
            margin-bottom: 4px;
        }

        .help-link {
            text-align: center;
            margin-top: 16px;
        }

        .help-link a {
            color: var(--accent);
            text-decoration: none;
            font-size: 13px;
            font-weight: 600;
        }

        .help-link a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="${iconUri}" alt="Icon" class="icon-img">
            <h1>Setup Required</h1>
            <p class="subtitle">Enable Chrome DevTools Protocol for ${ideName}</p>
        </div>

        <div class="section">
            <div class="step">
                <div class="step-number">1</div>
                <div class="step-content">
                    <div class="step-title">Copy Setup Script</div>
                    <div class="step-description">Click the button to copy the script to your clipboard</div>
                    <button class="btn-copy" onclick="copyScript()">
                        \u{1F4CB} Copy Setup Script
                    </button>
                </div>
            </div>

            <div class="step">
                <div class="step-number">2</div>
                <div class="step-content">
                    <div class="step-title">Run in ${terminalName}</div>
                    <div class="step-description">Paste and execute the script in ${terminalName}</div>
                </div>
            </div>

            <div class="step">
                <div class="step-number">3</div>
                <div class="step-content">
                    <div class="step-title">Restart ${ideName}</div>
                    <div class="step-description">Completely close and restart ${ideName} for changes to take effect</div>
                </div>
            </div>
        </div>

        ${platform === "win32" ? `
        <div class="warning">
            <strong>\u26A0\uFE0F Windows Users</strong>
            Right-click PowerShell and select "Run as Administrator" before pasting the script.
        </div>
        ` : ""}

        <div class="help-link">
            <a href="#" onclick="openHelp(); return false;">Need help? View setup guide \u2192</a>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function copyScript() {
            vscode.postMessage({ command: 'copyScript' });
        }

        function openHelp() {
            vscode.postMessage({ command: 'openHelp' });
        }
    </script>
</body>
</html>`;
      }
      _escapeHtml(text) {
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
      }
      dispose() {
        _SetupPanel.currentPanel = void 0;
        this._panel.dispose();
        while (this._disposables.length) {
          const disposable = this._disposables.pop();
          if (disposable) {
            disposable.dispose();
          }
        }
      }
    };
    exports2.SetupPanel = SetupPanel;
  }
});

// main_scripts/relauncher.js
var require_relauncher = __commonJS({
  "main_scripts/relauncher.js"(exports2, module2) {
    var vscode2 = require("vscode");
    var { execSync, spawn } = require("child_process");
    var os = require("os");
    var fs = require("fs");
    var path2 = require("path");
    var CDP_PORT = 9e3;
    var CDP_FLAG = `--remote-debugging-port=${CDP_PORT}`;
    var Relauncher = class {
      constructor(logger = console.log) {
        this.platform = os.platform();
        this.logger = logger;
      }
      log(msg) {
        this.logger(`[Relauncher] ${msg}`);
      }
      /**
       * Get the human-readable name of the IDE (Cursor, Antigravity, VS Code)
       */
      getIdeName() {
        const appName = vscode2.env.appName || "";
        if (appName.toLowerCase().includes("cursor")) return "Cursor";
        if (appName.toLowerCase().includes("antigravity")) return "Antigravity";
        return "Code";
      }
      /**
       * Main entry point: ensures CDP is enabled and relaunches if necessary
       */
      async ensureCDPAndRelaunch() {
        this.log("Checking if current process has CDP flag...");
        const hasFlag = await this.checkShortcutFlag();
        const ideName = this.getIdeName();
        if (hasFlag) {
          this.log("CDP flag present but port inactive. Prompting for restart.");
          vscode2.window.showWarningMessage(
            `Auto Accept: The CDP flag is present, but the debugger port is not responding. Please completely close and restart ${ideName}.`,
            "Restart Now"
          ).then((selection) => {
            if (selection === "Restart Now") {
              vscode2.commands.executeCommand("workbench.action.reloadWindow");
            }
          });
          return { success: true, relaunched: false };
        }
        this.log("CDP flag missing in current process. Showing platform-specific script...");
        const { script, instructions } = await this.getPlatformScriptAndInstructions();
        if (!script) {
          vscode2.window.showErrorMessage(
            `Auto Accept: Unsupported platform. Please add --remote-debugging-port=9000 to your ${ideName} shortcut manually, then restart.`,
            "View Help"
          ).then((selection) => {
            if (selection === "View Help") {
              vscode2.env.openExternal(vscode2.Uri.parse("https://github.com/MunKhin/auto-accept-agent/blob/master/SETUP_GUIDE.md"));
            }
          });
          return { success: false, relaunched: false };
        }
        try {
          const { SetupPanel } = require_setup_panel();
          const extensionPath = vscode2.extensions.getExtension("MunKhin.auto-accept-agent")?.extensionUri;
          if (extensionPath) {
            SetupPanel.createOrShow(extensionPath, script, this.platform, ideName);
          } else {
            this.log("Failed to get extension URI, falling back to notification");
            await this.showFallbackNotification(script, ideName);
          }
        } catch (err) {
          this.log(`Failed to load SetupPanel: ${err.message}, falling back to notification`);
          await this.showFallbackNotification(script, ideName);
        }
        return { success: true, relaunched: false };
      }
      /**
       * Platform-specific check if the current launch shortcut has the flag
       */
      async checkShortcutFlag() {
        const args = process.argv.join(" ");
        return args.includes("--remote-debugging-port=9000");
      }
      /**
       * Fallback notification if SetupPanel fails to load
       */
      async showFallbackNotification(script, ideName) {
        const message = `Auto Accept: Click the button below to copy the setup script for ${ideName}.`;
        const copyButton = "Copy Setup Script";
        const viewHelpButton = "View Help";
        const selection = await vscode2.window.showInformationMessage(
          message,
          copyButton,
          viewHelpButton
        );
        if (selection === copyButton) {
          await vscode2.env.clipboard.writeText(script);
          const terminalName = this.platform === "win32" ? "PowerShell (as Administrator)" : "Terminal";
          vscode2.window.showInformationMessage(`Script copied! Please paste and run it in ${terminalName}, then restart ${ideName}.`);
        } else if (selection === viewHelpButton) {
          vscode2.env.openExternal(vscode2.Uri.parse("https://github.com/Antigravity-AI/auto-accept#background-mode-setup"));
        }
      }
      /**
       * Get platform-specific script and instructions for enabling CDP
       */
      async getPlatformScriptAndInstructions() {
        const ideName = this.getIdeName();
        const platform = this.platform;
        if (platform === "win32") {
          const script = `# Universal Windows Script - Adds CDP Port to ${ideName}
Write-Host "=== ${ideName} CDP Setup ===" -ForegroundColor Cyan
Write-Host "Searching for ${ideName} shortcuts..." -ForegroundColor Yellow

# Define search locations
$searchLocations = @(
    [Environment]::GetFolderPath('Desktop'),
    "$env:USERPROFILE\\Desktop",
    "$env:USERPROFILE\\OneDrive\\Desktop",
    "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
    "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
    "$env:USERPROFILE\\AppData\\Roaming\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar"
)

$WshShell = New-Object -ComObject WScript.Shell
$foundShortcuts = @()

# Search for shortcuts
foreach ($location in $searchLocations) {
    if (Test-Path $location) {
        Write-Host "Searching: $location"
        $shortcuts = Get-ChildItem -Path $location -Recurse -Filter "*.lnk" -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "*${ideName}*" }
        $foundShortcuts += $shortcuts
    }
}

if ($foundShortcuts.Count -eq 0) {
    Write-Host "No shortcuts found. Searching for ${ideName} installation..." -ForegroundColor Yellow
    $exePath = "$env:LOCALAPPDATA\\Programs\\${ideName}\\${ideName}.exe"

    if (Test-Path $exePath) {
        $desktopPath = [Environment]::GetFolderPath('Desktop')
        $shortcutPath = "$desktopPath\\${ideName}.lnk"
        $shortcut = $WshShell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $exePath
        $shortcut.Arguments = "--remote-debugging-port=9000"
        $shortcut.Save()
        Write-Host "Created new shortcut: $shortcutPath" -ForegroundColor Green
    } else {
        Write-Host "ERROR: ${ideName}.exe not found. Please install ${ideName} first." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Found $($foundShortcuts.Count) shortcut(s)" -ForegroundColor Green
    foreach ($shortcutFile in $foundShortcuts) {
        $shortcut = $WshShell.CreateShortcut($shortcutFile.FullName)
        $originalArgs = $shortcut.Arguments

        if ($originalArgs -match "--remote-debugging-port=\\d+") {
            $shortcut.Arguments = $originalArgs -replace "--remote-debugging-port=\\d+", "--remote-debugging-port=9000"
        } else {
            $shortcut.Arguments = "--remote-debugging-port=9000 " + $originalArgs
        }
        $shortcut.Save()
        Write-Host "Updated: $($shortcutFile.Name)" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host "Please restart ${ideName} completely for changes to take effect." -ForegroundColor Yellow`;
          return {
            script,
            instructions: `1. Open PowerShell as Administrator
2. Copy the script above and paste it into PowerShell
3. Press Enter to run
4. After the script completes, close and restart ${ideName} completely.`
          };
        } else if (platform === "darwin") {
          const script = `#!/bin/bash
# macOS CDP Setup for ${ideName}
# Creates a launch wrapper \u2014 does NOT modify the app bundle (preserves code signing).

echo "=== ${ideName} CDP Setup ==="
echo ""

IDE_NAME="${ideName}"

# Search for the app
APP_LOCATIONS=(
    "/Applications"
    "$HOME/Applications"
    "/Applications/Utilities"
)

app_path=""
for location in "\${APP_LOCATIONS[@]}"; do
    if [ -d "$location" ]; then
        echo "Searching: $location"
        found=$(find "$location" -maxdepth 2 -name "*\${IDE_NAME}*.app" -type d 2>/dev/null | head -n1)
        if [ -n "$found" ]; then
            app_path="$found"
            echo "Found: $app_path"
            break
        fi
    fi
done

if [ -z "$app_path" ]; then
    echo ""
    echo "ERROR: ${ideName}.app not found in standard locations."
    echo "Please install ${ideName} first."
    exit 1
fi

echo ""

# Create a Desktop launcher (.command file \u2014 double-click to launch)
wrapper_path="$HOME/Desktop/\${IDE_NAME}-CDP.command"

# Write the launcher script
echo '#!/bin/bash' > "$wrapper_path"
echo "open -n -a \\"$app_path\\" --args --remote-debugging-port=9000" >> "$wrapper_path"
chmod +x "$wrapper_path"
echo "Created Desktop launcher: $wrapper_path"

# Add shell alias to .zshrc (default macOS shell)
shell_rc="$HOME/.zshrc"
alias_name=$(echo "$IDE_NAME" | tr '[:upper:]' '[:lower:]')-cdp

if [ -f "$shell_rc" ] && grep -q "$alias_name" "$shell_rc"; then
    echo "Shell alias '$alias_name' already exists in $shell_rc"
else
    echo "" >> "$shell_rc"
    echo "# Auto Accept \u2014 launch $IDE_NAME with CDP" >> "$shell_rc"
    echo "alias $alias_name='open -n -a \\"$app_path\\" --args --remote-debugging-port=9000'" >> "$shell_rc"
    echo "Added shell alias '$alias_name' to $shell_rc"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Launch ${ideName} with CDP enabled using ONE of these methods:"
echo "  1. Double-click '\${IDE_NAME}-CDP.command' on your Desktop"
echo "  2. Open a new Terminal and type: $alias_name"
echo "  3. Run: open -n -a \\"${ideName}\\" --args --remote-debugging-port=9000"
echo ""
echo "NOTE: The Dock icon launches WITHOUT CDP. Always use one of the methods above."`;
          return {
            script,
            instructions: `1. Open Terminal
2. Paste the script and press Enter
3. Use the new Desktop launcher or terminal alias to start ${ideName} with CDP
4. Always launch via the wrapper \u2014 the Dock icon does not enable CDP.`
          };
        } else if (platform === "linux") {
          const script = `#!/bin/bash
# Universal Linux Script - Adds CDP Port to ${ideName}

echo "=== ${ideName} CDP Setup ==="
echo ""
echo "Searching for ${ideName} shortcuts..."

IDE_NAME="${ideName}"
IDE_NAME_LOWER=$(echo "$IDE_NAME" | tr '[:upper:]' '[:lower:]')

# Define search locations for .desktop files
SEARCH_LOCATIONS=(
    "$HOME/.local/share/applications"
    "$HOME/Desktop"
    "$HOME/.config/autostart"
    "/usr/share/applications"
    "/usr/local/share/applications"
    "/var/lib/snapd/desktop/applications"
    "/var/lib/flatpak/exports/share/applications"
)

# Function to add CDP port to a .desktop file
add_cdp_to_desktop_file() {
    local desktop_file="$1"
    local backup_file="\${desktop_file}.bak"

    # Check if CDP port already exists
    if grep -q "remote-debugging-port" "$desktop_file"; then
        echo "  Status: CDP port already present"
        return 0
    fi

    # Create backup
    cp "$desktop_file" "$backup_file"
    echo "  Backup created: $backup_file"

    # Add CDP port to Exec lines
    sed -i 's|^Exec=\\(.*\\)$|Exec=\\1 --remote-debugging-port=9000|' "$desktop_file"

    # Add to TryExec if present
    if grep -q "^TryExec=" "$desktop_file"; then
        sed -i 's|^TryExec=\\(.*\\)$|TryExec=\\1 --remote-debugging-port=9000|' "$desktop_file"
    fi

    echo "  Status: CDP port added"
    return 0
}

found_count=0

# Search for .desktop files
for dir in "\${SEARCH_LOCATIONS[@]}"; do
    if [ -d "$dir" ]; then
        echo "Searching: $dir"

        for file in "$dir"/*.desktop; do
            if [ -f "$file" ]; then
                # Check if file contains the IDE name
                if grep -qi "$IDE_NAME_LOWER" "$file" 2>/dev/null; then
                    echo ""
                    echo "---"
                    echo "Found: $(basename "$file")"
                    echo "Location: $file"

                    found_count=$((found_count + 1))
                    add_cdp_to_desktop_file "$file"
                fi
            fi
        done
    fi
done

echo ""
echo "=== Setup Complete ==="
echo "Total shortcuts found: $found_count"

if [ $found_count -eq 0 ]; then
    echo ""
    echo "No shortcuts found for '$IDE_NAME'."
    echo "Please make sure ${ideName} is installed."
else
    echo ""
    echo "Please restart ${ideName} completely for changes to take effect."
fi`;
          return {
            script,
            instructions: `1. Open Terminal
2. Copy the script above and paste it into Terminal
3. Make it executable: chmod +x script.sh (if saved as file)
4. Run the script with bash
5. After the script completes, close and restart ${ideName} completely.`
          };
        } else {
          return {
            script: "",
            instructions: "Unsupported platform. Please manually add --remote-debugging-port=9000 to your IDE shortcut."
          };
        }
      }
    };
    module2.exports = { Relauncher };
  }
});

// extension.js
var vscode = require("vscode");
var path = require("path");
var https = require("https");
var SettingsPanel = null;
function getSettingsPanel() {
  if (!SettingsPanel) {
    try {
      SettingsPanel = require_settings_panel().SettingsPanel;
    } catch (e) {
      console.error("Failed to load SettingsPanel:", e);
    }
  }
  return SettingsPanel;
}
var GLOBAL_STATE_KEY = "auto-accept-enabled-global";
var PRO_STATE_KEY = "auto-accept-isPro";
var FREQ_STATE_KEY = "auto-accept-frequency";
var BANNED_COMMANDS_KEY = "auto-accept-banned-commands";
var ROI_STATS_KEY = "auto-accept-roi-stats";
var SECONDS_PER_CLICK = 5;
var LICENSE_API = "https://auto-accept-backend.onrender.com/api";
var isEnabled = false;
var isPro = false;
var isLockedOut = false;
var pollFrequency = 1e3;
var bannedCommands = [];
var backgroundModeEnabled = false;
var BACKGROUND_DONT_SHOW_KEY = "auto-accept-background-dont-show";
var BACKGROUND_MODE_KEY = "auto-accept-background-mode";
var FIRST_INSTALL_KEY = "auto-accept-first-install-complete";
var SUMMARY_API_URL = `${LICENSE_API}/session-summary`;
var SESSION_LOG_LIMIT = 300;
var LOG_LINE_MAX_CHARS = 500;
var VISIBLE_TEXT_MAX_CHARS = 12e3;
var SUMMARY_REQUEST_TIMEOUT_MS = 8e3;
var pollTimer;
var statsCollectionTimer;
var statusBarItem;
var statusSettingsItem;
var statusBackgroundItem;
var outputChannel;
var currentIDE = "unknown";
var globalContext;
var summaryRequestInFlight = false;
var currentSession = null;
var sessionLogBuffer = [];
var sessionCounter = 0;
var lastSessionSummary = null;
var cdpHandler;
var relauncher;
function log(message) {
  try {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().split("T")[1].split(".")[0];
    const logLine = `[${timestamp}] ${message}`;
    console.log(logLine);
    if (outputChannel) {
      outputChannel.appendLine(logLine);
    }
    appendSessionLog(logLine);
  } catch (e) {
    console.error("Logging failed:", e);
  }
}
function detectIDE() {
  const appName = vscode.env.appName || "";
  if (appName.toLowerCase().includes("cursor")) return "Cursor";
  if (appName.toLowerCase().includes("antigravity")) return "Antigravity";
  return "Code";
}
function appendSessionLog(line) {
  if (!line) return;
  sessionLogBuffer.push(String(line).slice(0, LOG_LINE_MAX_CHARS));
  if (sessionLogBuffer.length > SESSION_LOG_LIMIT) {
    sessionLogBuffer = sessionLogBuffer.slice(sessionLogBuffer.length - SESSION_LOG_LIMIT);
  }
}
function ensureSessionStarted() {
  if (currentSession && !currentSession.endedAt) return;
  sessionCounter += 1;
  lastSessionSummary = null;
  currentSession = {
    sessionId: `session-${Date.now()}-${sessionCounter}`,
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    endedAt: null,
    ide: String(currentIDE || "unknown").toLowerCase(),
    backgroundMode: !!backgroundModeEnabled
  };
  sessionLogBuffer = [];
  appendSessionLog(`[SESSION] Started ${currentSession.sessionId}`);
}
function markSessionEnded() {
  if (!currentSession || currentSession.endedAt) return;
  currentSession.endedAt = (/* @__PURE__ */ new Date()).toISOString();
  appendSessionLog(`[SESSION] Ended ${currentSession.sessionId}`);
}
function truncateText(text, maxChars) {
  const value = String(text || "");
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}
function redactSensitiveText(text) {
  return String(text || "").replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_KEY]").replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/ig, "$1[REDACTED_TOKEN]").replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]");
}
function normalizeStats(stats) {
  const base = stats || {};
  return {
    clicks: Number(base.clicks || 0),
    blocked: Number(base.blocked || 0),
    fileEdits: Number(base.fileEdits || 0),
    terminalCommands: Number(base.terminalCommands || 0)
  };
}
function hasMeaningfulSummaryInput(stats, logs, visibleConversationText) {
  const s = normalizeStats(stats);
  const totalStats = s.clicks + s.blocked + s.fileEdits + s.terminalCommands;
  return totalStats > 0 || logs.length > 0 || String(visibleConversationText || "").trim().length > 0;
}
function buildSummaryPayload(context, stats, visibleConversationText) {
  const safeLogs = sessionLogBuffer.map((line) => truncateText(redactSensitiveText(line), LOG_LINE_MAX_CHARS));
  const sessionMeta = {
    sessionId: currentSession?.sessionId || `session-${Date.now()}-ad-hoc`,
    startedAt: currentSession?.startedAt || null,
    endedAt: currentSession?.endedAt || null,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    ide: currentSession?.ide || String(currentIDE || "unknown").toLowerCase(),
    backgroundMode: currentSession?.backgroundMode ?? !!backgroundModeEnabled
  };
  return {
    userId: context.globalState.get("auto-accept-userId") || null,
    sessionMeta,
    stats: normalizeStats(stats),
    logs: safeLogs,
    visibleConversationText: truncateText(redactSensitiveText(visibleConversationText), VISIBLE_TEXT_MAX_CHARS)
  };
}
async function postJson(url, payload, timeoutMs = SUMMARY_REQUEST_TIMEOUT_MS) {
  const body = JSON.stringify(payload || {});
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: timeoutMs
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Summary API failed with status ${res.statusCode}`));
        }
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(new Error("Summary API returned invalid JSON."));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Summary API timed out.")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
async function generateSessionSummary(context, options = {}) {
  if (!context) throw new Error("Extension context unavailable.");
  if (summaryRequestInFlight) {
    if (!options.silent) {
      vscode.window.showInformationMessage("Auto Accept: Summary generation is already in progress.");
    }
    return lastSessionSummary;
  }
  const targetPageId = options.pageId || null;
  summaryRequestInFlight = true;
  if (targetPageId && cdpHandler) {
    await cdpHandler.pushSummaryResult(targetPageId, { status: "loading" });
  }
  try {
    const stats = cdpHandler ? await cdpHandler.getSessionSummary() : normalizeStats();
    const visibleConversationText = cdpHandler ? await cdpHandler.getVisibleConversationText(targetPageId, VISIBLE_TEXT_MAX_CHARS) : "";
    const payload = buildSummaryPayload(context, stats, visibleConversationText);
    if (!hasMeaningfulSummaryInput(payload.stats, payload.logs, payload.visibleConversationText)) {
      throw new Error("Not enough session data to summarize yet.");
    }
    const response = await postJson(SUMMARY_API_URL, payload, SUMMARY_REQUEST_TIMEOUT_MS);
    const summaryText = String(response.summary || "").trim();
    if (!summaryText) {
      throw new Error("Summary API returned empty summary text.");
    }
    lastSessionSummary = {
      summary: summaryText,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      sessionId: payload.sessionMeta.sessionId
    };
    log(`[Summary] Generated for ${lastSessionSummary.sessionId}`);
    if (cdpHandler) {
      await cdpHandler.pushSummaryResult(targetPageId, {
        status: "success",
        summary: summaryText,
        generatedAt: lastSessionSummary.generatedAt
      });
    }
    if (!options.silent) {
      vscode.window.showInformationMessage("Auto Accept: Session summary ready.");
    }
    return lastSessionSummary;
  } catch (e) {
    log(`[Summary] Failed: ${e.message}`);
    if (cdpHandler) {
      await cdpHandler.pushSummaryResult(targetPageId, {
        status: "error",
        error: "Failed to generate summary. Please try again."
      });
    }
    if (!options.silent) {
      vscode.window.showErrorMessage(`Auto Accept: ${e.message}`);
    }
    throw e;
  } finally {
    summaryRequestInFlight = false;
  }
}
async function checkForSummaryRequests(context) {
  if (!isEnabled || backgroundModeEnabled || !cdpHandler || summaryRequestInFlight) return;
  try {
    const requests = await cdpHandler.consumeSummaryRequests();
    if (!Array.isArray(requests) || requests.length === 0) return;
    const primary = requests[0];
    const result = await generateSessionSummary(context, {
      pageId: primary.id,
      source: "overlay",
      silent: true
    });
    for (let i = 1; i < requests.length; i++) {
      await cdpHandler.pushSummaryResult(requests[i].id, {
        status: "success",
        summary: result?.summary || "",
        generatedAt: result?.generatedAt || (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  } catch (e) {
    log(`[Summary] Request processing error: ${e.message}`);
  }
}
async function activate(context) {
  globalContext = context;
  console.log("Auto Accept Extension: Activator called.");
  try {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = "auto-accept.toggle";
    statusBarItem.text = "$(sync~spin) Auto Accept: Loading...";
    statusBarItem.tooltip = "Auto Accept is initializing...";
    context.subscriptions.push(statusBarItem);
    statusBarItem.show();
    statusSettingsItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
    statusSettingsItem.command = "auto-accept.openSettings";
    statusSettingsItem.text = "$(gear)";
    statusSettingsItem.tooltip = "Auto Accept Settings & Pro Features";
    context.subscriptions.push(statusSettingsItem);
    statusSettingsItem.show();
    statusBackgroundItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    statusBackgroundItem.command = "auto-accept.toggleBackground";
    statusBackgroundItem.text = "$(globe) Background: OFF";
    statusBackgroundItem.tooltip = "Background Mode (Pro) - Works on all chats";
    context.subscriptions.push(statusBackgroundItem);
    console.log("Auto Accept: Status bar items created and shown.");
  } catch (sbError) {
    console.error("CRITICAL: Failed to create status bar items:", sbError);
  }
  try {
    isEnabled = context.globalState.get(GLOBAL_STATE_KEY, false);
    isPro = context.globalState.get(PRO_STATE_KEY, false);
    pollFrequency = context.globalState.get(FREQ_STATE_KEY, 1e3);
    backgroundModeEnabled = context.globalState.get(BACKGROUND_MODE_KEY, false);
    const defaultBannedCommands = [
      "rm -rf /",
      "rm -rf ~",
      "rm -rf *",
      "format c:",
      "del /f /s /q",
      "rmdir /s /q",
      ":(){:|:&};:",
      // fork bomb
      "dd if=",
      "mkfs.",
      "> /dev/sda",
      "chmod -R 777 /"
    ];
    bannedCommands = context.globalState.get(BANNED_COMMANDS_KEY, defaultBannedCommands);
    verifyLicense(context).then((isValid) => {
      if (isValid === null) {
        log("License re-verification: Network error, preserving current Pro status");
        return;
      }
      if (isPro !== isValid) {
        isPro = isValid;
        context.globalState.update(PRO_STATE_KEY, isValid);
        log(`License re-verification: Updated Pro status to ${isValid}`);
        if (cdpHandler && cdpHandler.setProStatus) {
          cdpHandler.setProStatus(isValid);
        }
        updateStatusBar();
      }
    });
    currentIDE = detectIDE();
    outputChannel = vscode.window.createOutputChannel("Auto Accept");
    context.subscriptions.push(outputChannel);
    log(`Auto Accept: Activating...`);
    log(`Auto Accept: Detected environment: ${currentIDE.toUpperCase()}`);
    vscode.window.onDidChangeWindowState(async (e) => {
      if (cdpHandler && cdpHandler.setFocusState) {
        await cdpHandler.setFocusState(e.focused);
      }
      if (e.focused && isEnabled) {
        log(`[Away] Window focus detected by VS Code API. Checking for away actions...`);
        setTimeout(() => checkForAwayActions(context), 500);
      }
    });
    try {
      const { CDPHandler } = require_cdp_handler();
      const { Relauncher } = require_relauncher();
      cdpHandler = new CDPHandler(log);
      relauncher = new Relauncher(log);
      log(`CDP handlers initialized for ${currentIDE}.`);
    } catch (err) {
      log(`Failed to initialize CDP handlers: ${err.message}`);
      vscode.window.showErrorMessage(`Auto Accept Error: ${err.message}`);
    }
    updateStatusBar();
    log("Status bar updated with current state.");
    context.subscriptions.push(
      vscode.commands.registerCommand("auto-accept.toggle", () => handleToggle(context)),
      vscode.commands.registerCommand("auto-accept.relaunch", () => handleRelaunch()),
      vscode.commands.registerCommand("auto-accept.updateFrequency", (freq) => handleFrequencyUpdate(context, freq)),
      vscode.commands.registerCommand("auto-accept.toggleBackground", () => handleBackgroundToggle(context)),
      vscode.commands.registerCommand("auto-accept.updateBannedCommands", (commands) => handleBannedCommandsUpdate(context, commands)),
      vscode.commands.registerCommand("auto-accept.getBannedCommands", () => bannedCommands),
      vscode.commands.registerCommand("auto-accept.getROIStats", async () => {
        const stats = await loadROIStats(context);
        const timeSavedSeconds = stats.clicksThisWeek * SECONDS_PER_CLICK;
        const timeSavedMinutes = Math.round(timeSavedSeconds / 60);
        return {
          ...stats,
          timeSavedMinutes,
          timeSavedFormatted: timeSavedMinutes >= 60 ? `${(timeSavedMinutes / 60).toFixed(1)} hours` : `${timeSavedMinutes} minutes`
        };
      }),
      vscode.commands.registerCommand("auto-accept.openSettings", () => {
        const panel = getSettingsPanel();
        if (panel) {
          panel.createOrShow(context.extensionUri, context);
        } else {
          vscode.window.showErrorMessage("Failed to load Settings Panel.");
        }
      }),
      vscode.commands.registerCommand("auto-accept.generateSessionSummary", () => generateSessionSummary(context, { source: "command", silent: false })),
      vscode.commands.registerCommand("auto-accept.getLastSessionSummary", () => lastSessionSummary),
      vscode.commands.registerCommand("auto-accept.activatePro", () => handleProActivation(context)),
      vscode.commands.registerCommand("auto-accept.onPaid", () => handlePaidActivation(context))
    );
    const uriHandler = {
      handleUri(uri) {
        log(`URI Handler received: ${uri.toString()}`);
        if (uri.path === "/activate" || uri.path === "activate") {
          log("Activation URI detected - verifying pro status...");
          handleProActivation(context);
        }
      }
    };
    context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));
    log("URI Handler registered for activation deep links.");
    try {
      await checkEnvironmentAndStart();
    } catch (err) {
      log(`Error in environment check: ${err.message}`);
    }
    showFirstTimeGuide(context);
    log("Auto Accept: Activation complete");
  } catch (error) {
    console.error("ACTIVATION CRITICAL FAILURE:", error);
    log(`ACTIVATION CRITICAL FAILURE: ${error.message}`);
    vscode.window.showErrorMessage(`Auto Accept Extension failed to activate: ${error.message}`);
  }
}
async function ensureCDPOrPrompt(showPrompt = false) {
  if (!cdpHandler) return false;
  log("Checking for active CDP session...");
  const cdpAvailable = await cdpHandler.isCDPAvailable();
  log(`Environment check: CDP Available = ${cdpAvailable}`);
  if (cdpAvailable) {
    log("CDP is active and available.");
    return true;
  } else {
    log("CDP not found on target ports (9000 +/- 3).");
    if (showPrompt && relauncher) {
      log("Initiating CDP setup flow...");
      await relauncher.ensureCDPAndRelaunch();
    }
    return false;
  }
}
async function checkEnvironmentAndStart() {
  if (isEnabled) {
    if (!isPro) {
      log("Auto Accept enabled but license not verified. Disabling until licensed.");
      isEnabled = false;
      await globalContext.globalState.update(GLOBAL_STATE_KEY, false);
      updateStatusBar();
      return;
    }
    log("Initializing Auto Accept environment...");
    const cdpAvailable = await ensureCDPOrPrompt(true);
    if (!cdpAvailable) {
      log("CDP not available. Prompting user for setup.");
      return;
    }
    await startPolling();
    startStatsCollection(globalContext);
  }
  updateStatusBar();
}
async function handleToggle(context) {
  log("=== handleToggle CALLED ===");
  log(`  Previous isEnabled: ${isEnabled}`);
  try {
    if (!isEnabled && !isPro) {
      vscode.window.showInformationMessage(
        "Auto Accept requires an active license.",
        "Purchase License"
      ).then((choice) => {
        if (choice === "Purchase License") {
          vscode.commands.executeCommand("auto-accept.openSettings");
        }
      });
      return;
    }
    isEnabled = !isEnabled;
    log(`  New isEnabled: ${isEnabled}`);
    await context.globalState.update(GLOBAL_STATE_KEY, isEnabled);
    log(`  GlobalState updated`);
    log("  Calling updateStatusBar...");
    updateStatusBar();
    if (isEnabled) {
      log("Auto Accept: Enabled");
      const cdpAvailable = await ensureCDPOrPrompt(true);
      if (!cdpAvailable) {
        log("CDP not available. Prompting user for setup.");
        return;
      }
      startPolling();
      startStatsCollection(context);
      incrementSessionCount(context);
    } else {
      log("Auto Accept: Disabled");
      markSessionEnded();
      if (cdpHandler) {
        cdpHandler.getSessionSummary().then((summary) => showSessionSummaryNotification(context, summary)).catch(() => {
        });
      }
      collectAndSaveStats(context).catch(() => {
      });
      stopPolling().catch(() => {
      });
    }
    log("=== handleToggle COMPLETE ===");
  } catch (e) {
    log(`Error toggling: ${e.message}`);
    log(`Error stack: ${e.stack}`);
  }
}
async function handlePaidActivation(context) {
  if (!isPro) {
    log("handlePaidActivation called but Pro not verified.");
    return;
  }
  log("Paid activation confirmed. Starting CDP setup...");
  await ensureCDPOrPrompt(true);
  if (isEnabled) {
    await startPolling();
  }
}
async function handleRelaunch() {
  if (!relauncher) {
    vscode.window.showErrorMessage("Relauncher not initialized.");
    return;
  }
  if (!isPro) {
    vscode.window.showInformationMessage(
      "Auto Accept requires an active license.",
      "Purchase License"
    ).then((choice) => {
      if (choice === "Purchase License") {
        vscode.commands.executeCommand("auto-accept.openSettings");
      }
    });
    return;
  }
  log("Initiating CDP Setup flow...");
  await relauncher.ensureCDPAndRelaunch();
}
async function handleFrequencyUpdate(context, freq) {
  pollFrequency = freq;
  await context.globalState.update(FREQ_STATE_KEY, freq);
  log(`Poll frequency updated to: ${freq}ms`);
  if (isEnabled) {
    await syncSessions();
  }
}
async function handleBannedCommandsUpdate(context, commands) {
  if (!isPro) {
    log("Banned commands customization requires an active license");
    return;
  }
  bannedCommands = Array.isArray(commands) ? commands : [];
  await context.globalState.update(BANNED_COMMANDS_KEY, bannedCommands);
  log(`Banned commands updated: ${bannedCommands.length} patterns`);
  if (bannedCommands.length > 0) {
    log(`Banned patterns: ${bannedCommands.slice(0, 5).join(", ")}${bannedCommands.length > 5 ? "..." : ""}`);
  }
  if (isEnabled) {
    await syncSessions();
  }
}
async function handleBackgroundToggle(context) {
  log("Background toggle clicked");
  if (!isPro) {
    vscode.window.showInformationMessage(
      "Auto Accept requires an active license.",
      "Purchase License"
    ).then((choice) => {
      if (choice === "Purchase License") {
        vscode.commands.executeCommand("auto-accept.openSettings");
      }
    });
    return;
  }
  if (!backgroundModeEnabled) {
    const cdpAvailable = cdpHandler ? await cdpHandler.isCDPAvailable() : false;
    if (!cdpAvailable && relauncher) {
      log("Background Mode requires CDP. Prompting for setup...");
      await relauncher.ensureCDPAndRelaunch();
      return;
    }
  }
  const dontShowAgain = context.globalState.get(BACKGROUND_DONT_SHOW_KEY, false);
  if (!dontShowAgain && !backgroundModeEnabled) {
    const choice = await vscode.window.showInformationMessage(
      "Turn on Background Mode?\n\nThis lets Auto Accept work on all your open chats at once. It will switch between tabs to click Accept for you.\n\nYou might see tabs change quickly while it works.",
      { modal: true },
      "Enable",
      "Don't Show Again & Enable",
      "Cancel"
    );
    if (choice === "Cancel" || !choice) {
      log("Background mode cancelled by user");
      return;
    }
    if (choice === "Don't Show Again & Enable") {
      await context.globalState.update(BACKGROUND_DONT_SHOW_KEY, true);
      log("Background mode: Dont show again set");
    }
    backgroundModeEnabled = true;
    await context.globalState.update(BACKGROUND_MODE_KEY, true);
    log("Background mode enabled");
  } else {
    backgroundModeEnabled = !backgroundModeEnabled;
    await context.globalState.update(BACKGROUND_MODE_KEY, backgroundModeEnabled);
    log(`Background mode toggled: ${backgroundModeEnabled}`);
    if (!backgroundModeEnabled && cdpHandler && isEnabled) {
      log("Background mode OFF: Stopping background loops...");
      await cdpHandler.stop();
      await syncSessions();
      log("Background mode OFF: Restarted in simple mode");
    } else if (backgroundModeEnabled && cdpHandler && isEnabled) {
      log("Background mode ON: Switching to background mode...");
      await syncSessions();
    }
    if (!backgroundModeEnabled && cdpHandler) {
      cdpHandler.hideBackgroundOverlay().catch(() => {
      });
    }
  }
  updateStatusBar();
}
async function syncSessions() {
  if (cdpHandler && !isLockedOut) {
    log(`CDP: Syncing sessions (Mode: ${backgroundModeEnabled ? "Background" : "Simple"})...`);
    try {
      await cdpHandler.start({
        isPro,
        isBackgroundMode: backgroundModeEnabled,
        pollInterval: pollFrequency,
        ide: currentIDE,
        bannedCommands
      });
    } catch (err) {
      log(`CDP: Sync error: ${err.message}`);
    }
  }
}
async function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  ensureSessionStarted();
  log("Auto Accept: Monitoring session...");
  await syncSessions();
  pollTimer = setInterval(async () => {
    if (!isEnabled) return;
    const lockKey = `${currentIDE.toLowerCase()}-instance-lock`;
    const activeInstance = globalContext.globalState.get(lockKey);
    const myId = globalContext.extension.id;
    if (activeInstance && activeInstance !== myId) {
      const lastPing = globalContext.globalState.get(`${lockKey}-ping`);
      if (lastPing && Date.now() - lastPing < 15e3) {
        if (!isLockedOut) {
          log(`CDP Control: Locked by another instance (${activeInstance}). Standby mode.`);
          isLockedOut = true;
          updateStatusBar();
        }
        return;
      }
    }
    globalContext.globalState.update(lockKey, myId);
    globalContext.globalState.update(`${lockKey}-ping`, Date.now());
    if (isLockedOut) {
      log("CDP Control: Lock acquired. Resuming control.");
      isLockedOut = false;
      updateStatusBar();
    }
    await syncSessions();
    checkForSummaryRequests(globalContext).catch(() => {
    });
  }, 5e3);
}
async function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (statsCollectionTimer) {
    clearInterval(statsCollectionTimer);
    statsCollectionTimer = null;
  }
  if (cdpHandler) await cdpHandler.stop();
  markSessionEnded();
  log("Auto Accept: Polling stopped");
}
function getWeekStart() {
  const now = /* @__PURE__ */ new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek;
  const weekStart = new Date(now.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart.getTime();
}
async function loadROIStats(context) {
  const defaultStats = {
    weekStart: getWeekStart(),
    clicksThisWeek: 0,
    blockedThisWeek: 0,
    sessionsThisWeek: 0
  };
  let stats = context.globalState.get(ROI_STATS_KEY, defaultStats);
  const currentWeekStart = getWeekStart();
  if (stats.weekStart !== currentWeekStart) {
    log(`ROI Stats: New week detected. Showing summary and resetting.`);
    if (stats.clicksThisWeek > 0) {
      await showWeeklySummaryNotification(context, stats);
    }
    stats = { ...defaultStats, weekStart: currentWeekStart };
    await context.globalState.update(ROI_STATS_KEY, stats);
  }
  return stats;
}
async function showWeeklySummaryNotification(context, lastWeekStats) {
  const timeSavedSeconds = lastWeekStats.clicksThisWeek * SECONDS_PER_CLICK;
  const timeSavedMinutes = Math.round(timeSavedSeconds / 60);
  let timeStr;
  if (timeSavedMinutes >= 60) {
    timeStr = `${(timeSavedMinutes / 60).toFixed(1)} hours`;
  } else {
    timeStr = `${timeSavedMinutes} minutes`;
  }
  const message = `\u{1F4CA} Last week, Auto Accept saved you ${timeStr} by auto-clicking ${lastWeekStats.clicksThisWeek} buttons!`;
  let detail = "";
  if (lastWeekStats.sessionsThisWeek > 0) {
    detail += `Recovered ${lastWeekStats.sessionsThisWeek} stuck sessions. `;
  }
  if (lastWeekStats.blockedThisWeek > 0) {
    detail += `Blocked ${lastWeekStats.blockedThisWeek} dangerous commands.`;
  }
  const choice = await vscode.window.showInformationMessage(
    message,
    { detail: detail.trim() || void 0 },
    "View Details"
  );
  if (choice === "View Details") {
    const panel = getSettingsPanel();
    if (panel) {
      panel.createOrShow(context.extensionUri, context);
    }
  }
}
async function showSessionSummaryNotification(context, summary) {
  log(`[Notification] showSessionSummaryNotification called with: ${JSON.stringify(summary)}`);
  if (!summary || summary.clicks === 0) {
    log(`[Notification] Session summary skipped: no clicks`);
    return;
  }
  log(`[Notification] Showing session summary for ${summary.clicks} clicks`);
  const lines = [
    `\u2705 This session:`,
    `\u2022 ${summary.clicks} actions auto-accepted`,
    `\u2022 ${summary.terminalCommands} terminal commands`,
    `\u2022 ${summary.fileEdits} file edits`,
    `\u2022 ${summary.blocked} interruptions blocked`
  ];
  if (summary.estimatedTimeSaved) {
    lines.push(`
\u23F1 Estimated time saved: ~${summary.estimatedTimeSaved} minutes`);
  }
  const message = lines.join("\n");
  vscode.window.showInformationMessage(
    `\u{1F916} Auto Accept: ${summary.clicks} actions handled this session`,
    { detail: message },
    "View Stats"
  ).then((choice) => {
    if (choice === "View Stats") {
      const panel = getSettingsPanel();
      if (panel) panel.createOrShow(context.extensionUri, context);
    }
  });
}
async function showAwayActionsNotification(context, actionsCount) {
  log(`[Notification] showAwayActionsNotification called with: ${actionsCount}`);
  if (!actionsCount || actionsCount === 0) {
    log(`[Notification] Away actions skipped: count is 0 or undefined`);
    return;
  }
  log(`[Notification] Showing away actions notification for ${actionsCount} actions`);
  const message = `\u{1F680} Auto Accept handled ${actionsCount} action${actionsCount > 1 ? "s" : ""} while you were away.`;
  const detail = `Agents stayed autonomous while you focused elsewhere.`;
  vscode.window.showInformationMessage(
    message,
    { detail },
    "View Dashboard"
  ).then((choice) => {
    if (choice === "View Dashboard") {
      const panel = getSettingsPanel();
      if (panel) panel.createOrShow(context.extensionUri, context);
    }
  });
}
var lastAwayCheck = Date.now();
async function checkForAwayActions(context) {
  log(`[Away] checkForAwayActions called. cdpHandler=${!!cdpHandler}, isEnabled=${isEnabled}`);
  if (!cdpHandler || !isEnabled) {
    log(`[Away] Skipping check: cdpHandler=${!!cdpHandler}, isEnabled=${isEnabled}`);
    return;
  }
  try {
    log(`[Away] Calling cdpHandler.getAwayActions()...`);
    const awayActions = await cdpHandler.getAwayActions();
    log(`[Away] Got awayActions: ${awayActions}`);
    if (awayActions > 0) {
      log(`[Away] Detected ${awayActions} actions while user was away. Showing notification...`);
      await showAwayActionsNotification(context, awayActions);
    } else {
      log(`[Away] No away actions to report`);
    }
  } catch (e) {
    log(`[Away] Error checking away actions: ${e.message}`);
  }
}
async function collectAndSaveStats(context) {
  if (!cdpHandler) return;
  try {
    const browserStats = await cdpHandler.resetStats();
    if (browserStats.clicks > 0 || browserStats.blocked > 0) {
      const currentStats = await loadROIStats(context);
      currentStats.clicksThisWeek += browserStats.clicks;
      currentStats.blockedThisWeek += browserStats.blocked;
      await context.globalState.update(ROI_STATS_KEY, currentStats);
      log(`ROI Stats collected: +${browserStats.clicks} clicks, +${browserStats.blocked} blocked (Total: ${currentStats.clicksThisWeek} clicks, ${currentStats.blockedThisWeek} blocked)`);
    }
  } catch (e) {
  }
}
async function incrementSessionCount(context) {
  const stats = await loadROIStats(context);
  stats.sessionsThisWeek++;
  await context.globalState.update(ROI_STATS_KEY, stats);
  log(`ROI Stats: Session count incremented to ${stats.sessionsThisWeek}`);
}
function startStatsCollection(context) {
  if (statsCollectionTimer) clearInterval(statsCollectionTimer);
  statsCollectionTimer = setInterval(() => {
    if (isEnabled) {
      collectAndSaveStats(context);
      checkForAwayActions(context);
    }
  }, 3e4);
  log("ROI Stats: Collection started (every 30s)");
}
function updateStatusBar() {
  if (!statusBarItem) return;
  if (isEnabled) {
    let statusText = "ON";
    let tooltip = `Auto Accept is running.`;
    let bgColor = void 0;
    let icon = "$(check)";
    const cdpConnected = cdpHandler && cdpHandler.getConnectionCount() > 0;
    if (cdpConnected) {
      tooltip += " (CDP Connected)";
    }
    if (isLockedOut) {
      statusText = "PAUSED (Multi-window)";
      bgColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      icon = "$(sync~spin)";
    }
    statusBarItem.text = `${icon} Auto Accept: ${statusText}`;
    statusBarItem.tooltip = tooltip;
    statusBarItem.backgroundColor = bgColor;
    if (statusBackgroundItem) {
      if (backgroundModeEnabled) {
        statusBackgroundItem.text = "$(sync~spin) Background: ON";
        statusBackgroundItem.tooltip = "Background Mode is on. Click to turn off.";
        statusBackgroundItem.backgroundColor = void 0;
      } else {
        statusBackgroundItem.text = "$(globe) Background: OFF";
        statusBackgroundItem.tooltip = "Click to turn on Background Mode (works on all your chats).";
        statusBackgroundItem.backgroundColor = void 0;
      }
      statusBackgroundItem.show();
    }
  } else {
    statusBarItem.text = "$(circle-slash) Auto Accept: OFF";
    statusBarItem.tooltip = "Click to enable Auto Accept.";
    statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    if (statusBackgroundItem) {
      statusBackgroundItem.hide();
    }
  }
}
async function verifyLicense(context, retries = 3) {
  const userId = context.globalState.get("auto-accept-userId");
  if (!userId) return false;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const req = https.get(`${LICENSE_API}/check-license?userId=${userId}`, { timeout: 5e3 }, (res) => {
          let data = "";
          res.on("data", (chunk) => data += chunk);
          res.on("end", () => {
            try {
              const json = JSON.parse(data);
              resolve(json.isPro === true);
            } catch (e) {
              reject(new Error("Invalid JSON"));
            }
          });
        });
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Timeout"));
        });
      });
      await context.globalState.update("auto-accept-last-verified", Date.now());
      return result;
    } catch (e) {
      log(`License verification attempt ${attempt}/${retries} failed: ${e.message}`);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1e3 * attempt));
      }
    }
  }
  const lastVerified = context.globalState.get("auto-accept-last-verified", 0);
  if (Date.now() - lastVerified < 24 * 60 * 60 * 1e3) {
    log("License verification: Network error, but verified within 24h. Preserving status.");
    return null;
  }
  log("License verification: Network error and stale cache. Returning null.");
  return null;
}
async function handleProActivation(context) {
  log("Pro Activation: Starting verification process...");
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Auto Accept: Verifying Pro status...",
      cancellable: false
    },
    async (progress) => {
      progress.report({ increment: 30 });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      progress.report({ increment: 30 });
      const isProNow = await verifyLicense(context);
      progress.report({ increment: 40 });
      if (isProNow) {
        isPro = true;
        await context.globalState.update(PRO_STATE_KEY, true);
        if (cdpHandler && cdpHandler.setProStatus) {
          cdpHandler.setProStatus(true);
        }
        pollFrequency = context.globalState.get(FREQ_STATE_KEY, 1e3);
        if (isEnabled) {
          await syncSessions();
        }
        updateStatusBar();
        await handlePaidActivation(context);
        log("Pro Activation: SUCCESS - User is now Pro!");
        vscode.window.showInformationMessage(
          "\u{1F389} Pro Activated! Thank you for your support. All Pro features are now unlocked.",
          "Open Dashboard"
        ).then((choice) => {
          if (choice === "Open Dashboard") {
            const panel = getSettingsPanel();
            if (panel) panel.createOrShow(context.extensionUri, context);
          }
        });
      } else {
        log("Pro Activation: License not found yet. Starting background polling...");
        startProPolling(context);
      }
    }
  );
}
var proPollingTimer = null;
var proPollingAttempts = 0;
var MAX_PRO_POLLING_ATTEMPTS = 24;
function startProPolling(context) {
  if (proPollingTimer) {
    clearInterval(proPollingTimer);
  }
  proPollingAttempts = 0;
  log("Pro Polling: Starting background verification (checking every 5s for up to 2 minutes)...");
  vscode.window.showInformationMessage(
    "Payment received! Verifying your Pro status... This may take a moment."
  );
  proPollingTimer = setInterval(async () => {
    proPollingAttempts++;
    log(`Pro Polling: Attempt ${proPollingAttempts}/${MAX_PRO_POLLING_ATTEMPTS}`);
    if (proPollingAttempts > MAX_PRO_POLLING_ATTEMPTS) {
      clearInterval(proPollingTimer);
      proPollingTimer = null;
      log("Pro Polling: Max attempts reached. User should check manually.");
      vscode.window.showWarningMessage(
        'Pro verification is taking longer than expected. Please click "Check Pro Status" in settings, or contact support if the issue persists.',
        "Open Settings"
      ).then((choice) => {
        if (choice === "Open Settings") {
          const panel = getSettingsPanel();
          if (panel) panel.createOrShow(context.extensionUri, context);
        }
      });
      return;
    }
    const isProNow = await verifyLicense(context);
    if (isProNow) {
      clearInterval(proPollingTimer);
      proPollingTimer = null;
      isPro = true;
      await context.globalState.update(PRO_STATE_KEY, true);
      if (cdpHandler && cdpHandler.setProStatus) {
        cdpHandler.setProStatus(true);
      }
      pollFrequency = context.globalState.get(FREQ_STATE_KEY, 1e3);
      if (isEnabled) {
        await syncSessions();
      }
      updateStatusBar();
      await handlePaidActivation(context);
      log("Pro Polling: SUCCESS - Pro status confirmed!");
      vscode.window.showInformationMessage(
        "\u{1F389} Pro Activated! Thank you for your support. All Pro features are now unlocked.",
        "Open Dashboard"
      ).then((choice) => {
        if (choice === "Open Dashboard") {
          const panel = getSettingsPanel();
          if (panel) panel.createOrShow(context.extensionUri, context);
        }
      });
    }
  }, 5e3);
}
async function showFirstTimeGuide(context) {
  const hasCompletedSetup = context.globalState.get(FIRST_INSTALL_KEY, false);
  if (hasCompletedSetup) return;
  await context.globalState.update(FIRST_INSTALL_KEY, true);
  log("First install detected. Showing user guide...");
  const welcomeChoice = await vscode.window.showInformationMessage(
    "Welcome to Auto Accept! Let's get you set up in 2 quick steps.",
    { modal: true },
    "Get Started",
    "Skip Setup"
  );
  if (welcomeChoice === "Skip Setup") return;
  const cdpAvailable = await ensureCDPOrPrompt(false);
  if (!cdpAvailable) {
    log("FTUE: CDP not available, prompting setup...");
    if (relauncher) {
      await relauncher.ensureCDPAndRelaunch();
    }
    return;
  }
  if (!isPro) {
    log("FTUE: CDP ready but no license. Showing payment prompt...");
    const panel = getSettingsPanel();
    if (panel) {
      panel.createOrShow(context.extensionUri, context, "prompt");
    }
    return;
  }
  await showFeatureGuide(context);
}
async function showFeatureGuide(context) {
  const guide = [
    '\u{1F4CB} Quick Guide:\n\n\u2022 Click "Auto Accept: OFF" in the status bar to toggle ON\n\u2022 Click the \u2699\uFE0F icon for settings (polling speed, banned commands)\n\u2022 Click "Background: OFF" to enable multi-tab mode\n\nAuto Accept clicks accept/run/retry buttons for you automatically.\nDangerous commands (rm -rf, format, etc.) are blocked by default.'
  ];
  const choice = await vscode.window.showInformationMessage(
    guide[0],
    { modal: true },
    "Open Settings",
    "Got it"
  );
  if (choice === "Open Settings") {
    const panel = getSettingsPanel();
    if (panel) panel.createOrShow(context.extensionUri, context);
  }
}
function deactivate() {
  stopPolling();
  markSessionEnded();
  if (cdpHandler) {
    cdpHandler.stop();
  }
}
module.exports = { activate, deactivate };
