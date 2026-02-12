const vscode = require('vscode');

/**
 * Setup Panel - Shows CDP setup instructions in a webview overlay
 * Displays all instructions in one screen with copy button
 */
class SetupPanel {
    static currentPanel = undefined;

    static createOrShow(extensionUri, script, platform, ideName) {
        const column = vscode.ViewColumn.One;

        // If we already have a panel, show it
        if (SetupPanel.currentPanel) {
            SetupPanel.currentPanel._panel.reveal(column);
            SetupPanel.currentPanel._update(script, platform, ideName);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'autoAcceptSetup',
            'Auto Accept Setup',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media'), extensionUri]
            }
        );

        SetupPanel.currentPanel = new SetupPanel(panel, extensionUri, script, platform, ideName);
    }

    constructor(panel, extensionUri, script, platform, ideName) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._script = script;
        this._platform = platform;
        this._ideName = ideName;
        this._disposables = [];

        // Set the webview's initial html content
        this._update(script, platform, ideName);

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'copyScript':
                        vscode.env.clipboard.writeText(this._script);
                        vscode.window.showInformationMessage('✅ Script copied to clipboard!');
                        return;
                    case 'openHelp':
                        vscode.env.openExternal(vscode.Uri.parse('https://github.com/MunKhin/auto-accept-agent/blob/master/SETUP_GUIDE.md'));
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
        const terminalName = platform === 'win32' ? 'PowerShell (as Administrator)' : 'Terminal';

        // Get icon URI
        const iconUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'icon.png')
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
                        📋 Copy Setup Script
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

        ${platform === 'win32' ? `
        <div class="warning">
            <strong>⚠️ Windows Users</strong>
            Right-click PowerShell and select "Run as Administrator" before pasting the script.
        </div>
        ` : ''}

        <div class="help-link">
            <a href="#" onclick="openHelp(); return false;">Need help? View setup guide →</a>
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
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    dispose() {
        SetupPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

exports.SetupPanel = SetupPanel;
