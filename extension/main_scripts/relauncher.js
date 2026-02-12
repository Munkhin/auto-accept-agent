const vscode = require('vscode');
const { execSync, spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const CDP_PORT = 9000;
const CDP_FLAG = `--remote-debugging-port=${CDP_PORT}`;

/**
 * Robust cross-platform manager for IDE shortcuts and relaunching
 */
class Relauncher {
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
        const appName = vscode.env.appName || '';
        if (appName.toLowerCase().includes('cursor')) return 'Cursor';
        if (appName.toLowerCase().includes('antigravity')) return 'Antigravity';
        return 'Code';
    }

    /**
     * Main entry point: ensures CDP is enabled and relaunches if necessary
     */
    async ensureCDPAndRelaunch() {
        this.log('Checking if current process has CDP flag...');
        const hasFlag = await this.checkShortcutFlag();

        if (hasFlag) {
            this.log('CDP flag present but port inactive. Prompting for restart.');
            vscode.window.showWarningMessage(
                `Auto Accept: The CDP flag is present, but the debugger port is not responding. Please completely close and restart ${ideName}.`,
                'Restart Now'
            ).then(selection => {
                if (selection === 'Restart Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
            return { success: true, relaunched: false };
        }

        this.log('CDP flag missing in current process. Showing platform-specific script...');
        const ideName = this.getIdeName();
        const { script, instructions } = await this.getPlatformScriptAndInstructions();

        if (!script) {
            vscode.window.showErrorMessage(
                `Auto Accept: Unsupported platform. Please add --remote-debugging-port=9000 to your ${ideName} shortcut manually, then restart.`,
                'View Help'
            ).then(selection => {
                if (selection === 'View Help') {
                    vscode.env.openExternal(vscode.Uri.parse('https://github.com/MunKhin/auto-accept-agent/blob/master/SETUP_GUIDE.md'));
                }
            });
            return { success: false, relaunched: false };
        }

        // Show setup overlay panel with all instructions in one screen
        try {
            const { SetupPanel } = require('../setup-panel');
            const extensionPath = vscode.extensions.getExtension('MunKhin.auto-accept-agent')?.extensionUri;
            if (extensionPath) {
                SetupPanel.createOrShow(extensionPath, script, this.platform, ideName);
            } else {
                this.log('Failed to get extension URI, falling back to notification');
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
        // Optimization: checking the process arguments of the current instance
        // This is the most reliable way to know if WE were launched with it
        const args = process.argv.join(' ');
        return args.includes('--remote-debugging-port=9000');
    }

    /**
     * Fallback notification if SetupPanel fails to load
     */
    async showFallbackNotification(script, ideName) {
        const message = `Auto Accept: Click the button below to copy the setup script for ${ideName}.`;
        const copyButton = 'Copy Setup Script';
        const viewHelpButton = 'View Help';

        const selection = await vscode.window.showInformationMessage(
            message,
            copyButton,
            viewHelpButton
        );

        if (selection === copyButton) {
            await vscode.env.clipboard.writeText(script);
            const terminalName = this.platform === 'win32' ? 'PowerShell (as Administrator)' : 'Terminal';
            vscode.window.showInformationMessage(`Script copied! Please paste and run it in ${terminalName}, then restart ${ideName}.`);
        } else if (selection === viewHelpButton) {
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/Antigravity-AI/auto-accept#background-mode-setup'));
        }
    }

    /**
     * Get platform-specific script and instructions for enabling CDP
     */
    async getPlatformScriptAndInstructions() {
        const ideName = this.getIdeName();
        const platform = this.platform;

        if (platform === 'win32') {
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
                instructions: `1. Open PowerShell as Administrator\n2. Copy the script above and paste it into PowerShell\n3. Press Enter to run\n4. After the script completes, close and restart ${ideName} completely.`
            };
        } else if (platform === 'darwin') {
            const script = `#!/bin/bash
# Universal macOS Script - Adds CDP Port to ${ideName}

echo "=== ${ideName} CDP Setup ==="
echo ""

IDE_NAME="${ideName}"

# Search for the app
APP_LOCATIONS=(
    "/Applications"
    "\$HOME/Applications"
    "/Applications/Utilities"
)

app_path=""
for location in "\${APP_LOCATIONS[@]}"; do
    if [ -d "\$location" ]; then
        echo "Searching: \$location"
        found=\$(find "\$location" -maxdepth 2 -name "*\${IDE_NAME}*.app" -type d 2>/dev/null | head -n1)
        if [ -n "\$found" ]; then
            app_path="\$found"
            echo "Found: \$app_path"
            break
        fi
    fi
done

if [ -z "\$app_path" ]; then
    echo ""
    echo "ERROR: ${ideName}.app not found in standard locations."
    echo "Please install ${ideName} first."
    exit 1
fi

info_plist="\$app_path/Contents/Info.plist"

if [ ! -f "\$info_plist" ]; then
    echo "ERROR: Info.plist not found at expected location."
    exit 1
fi

echo ""
echo "Checking Info.plist: \$info_plist"

# Check if CDP port already exists
if grep -q "remote-debugging-port" "\$info_plist"; then
    echo "CDP port already configured in Info.plist"
else
    # Create backup
    backup_plist="\${info_plist}.bak"
    cp "\$info_plist" "\$backup_plist"
    echo "Backup created: \$backup_plist"

    # Add CDP port configuration
    # Insert before closing </dict> tag
    sed -i '' '/<\\/dict>/i\\
    <key>LSArguments<\\/key>\\
    <array>\\
        <string>--remote-debugging-port=9000<\\/string>\\
    <\\/array>
' "\$info_plist"

    echo "CDP port added to Info.plist"
fi

echo ""
echo "=== Setup Complete ==="
echo "Please quit and restart ${ideName} completely for changes to take effect."
echo ""
echo "To launch with CDP flag temporarily, you can also use:"
echo "  open -n -a \\"${ideName}\\" --args --remote-debugging-port=9000"`;
            return {
                script,
                instructions: `1. Open Terminal\n2. Copy the script above and paste it into Terminal\n3. Press Enter to run\n4. After the script completes, quit and restart ${ideName} completely.`
            };
        } else if (platform === 'linux') {
            const script = `#!/bin/bash
# Universal Linux Script - Adds CDP Port to ${ideName}

echo "=== ${ideName} CDP Setup ==="
echo ""
echo "Searching for ${ideName} shortcuts..."

IDE_NAME="${ideName}"
IDE_NAME_LOWER=\$(echo "$IDE_NAME" | tr '[:upper:]' '[:lower:]')

# Define search locations for .desktop files
SEARCH_LOCATIONS=(
    "\$HOME/.local/share/applications"
    "\$HOME/Desktop"
    "\$HOME/.config/autostart"
    "/usr/share/applications"
    "/usr/local/share/applications"
    "/var/lib/snapd/desktop/applications"
    "/var/lib/flatpak/exports/share/applications"
)

# Function to add CDP port to a .desktop file
add_cdp_to_desktop_file() {
    local desktop_file="\$1"
    local backup_file="\${desktop_file}.bak"

    # Check if CDP port already exists
    if grep -q "remote-debugging-port" "\$desktop_file"; then
        echo "  Status: CDP port already present"
        return 0
    fi

    # Create backup
    cp "\$desktop_file" "\$backup_file"
    echo "  Backup created: \$backup_file"

    # Add CDP port to Exec lines
    sed -i 's|^Exec=\\(.*\\)$|Exec=\\1 --remote-debugging-port=9000|' "\$desktop_file"

    # Add to TryExec if present
    if grep -q "^TryExec=" "\$desktop_file"; then
        sed -i 's|^TryExec=\\(.*\\)$|TryExec=\\1 --remote-debugging-port=9000|' "\$desktop_file"
    fi

    echo "  Status: CDP port added"
    return 0
}

found_count=0

# Search for .desktop files
for dir in "\${SEARCH_LOCATIONS[@]}"; do
    if [ -d "\$dir" ]; then
        echo "Searching: \$dir"

        for file in "\$dir"/*.desktop; do
            if [ -f "\$file" ]; then
                # Check if file contains the IDE name
                if grep -qi "\$IDE_NAME_LOWER" "\$file" 2>/dev/null; then
                    echo ""
                    echo "---"
                    echo "Found: \$(basename "\$file")"
                    echo "Location: \$file"

                    found_count=\$((found_count + 1))
                    add_cdp_to_desktop_file "\$file"
                fi
            fi
        done
    fi
done

echo ""
echo "=== Setup Complete ==="
echo "Total shortcuts found: \$found_count"

if [ \$found_count -eq 0 ]; then
    echo ""
    echo "No shortcuts found for '\$IDE_NAME'."
    echo "Please make sure ${ideName} is installed."
else
    echo ""
    echo "Please restart ${ideName} completely for changes to take effect."
fi`;
            return {
                script,
                instructions: `1. Open Terminal\n2. Copy the script above and paste it into Terminal\n3. Make it executable: chmod +x script.sh (if saved as file)\n4. Run the script with bash\n5. After the script completes, close and restart ${ideName} completely.`
            };
        } else {
            return {
                script: '',
                instructions: 'Unsupported platform. Please manually add --remote-debugging-port=9000 to your IDE shortcut.'
            };
        }
    }
}

module.exports = { Relauncher };
