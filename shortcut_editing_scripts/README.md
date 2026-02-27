# Universal IDE CDP Port Remover Scripts

These scripts remove Chrome DevTools Protocol (CDP) `--remote-debugging-port` arguments from IDE shortcuts across all platforms.

## Features

- ✅ Works with **any IDE** (not hardcoded to specific apps)
- ✅ Searches the **entire system** intelligently (not just Desktop)
- ✅ Cross-platform support (Windows, macOS, Linux)
- ✅ Creates automatic backups before making changes
- ✅ Reports detailed status for each shortcut found

## Usage

### Windows

```powershell
# Run the PowerShell script
powershell -ExecutionPolicy Bypass -File windows.ps1

# Or with IDE name as parameter
powershell -ExecutionPolicy Bypass -File windows.ps1 -IDEName "Cursor"
```

**Searches:**
- Desktop (including OneDrive Desktop)
- Start Menu (User & System)
- Taskbar pinned shortcuts
- Quick Launch

### Linux

```bash
# Make executable
chmod +x linux.sh

# Run the script
./linux.sh

# Or with IDE name as parameter
./linux.sh cursor
```

**Searches:**
- `~/.local/share/applications`
- `~/Desktop`
- `~/.config/autostart`
- `/usr/share/applications`
- `/usr/local/share/applications`
- Snap applications
- Flatpak applications

### macOS

```bash
# Make executable
chmod +x mac.sh

# Run the script
./mac.sh

# Or with IDE name as parameter
./mac.sh "Visual Studio Code"
```

**Searches:**
- `/Applications`
- `~/Applications`
- `/Applications/Utilities`
- Info.plist configurations
- Launch wrapper scripts

## What It Does

1. **Prompts** for IDE name (if not provided as parameter)
2. **Searches** all common shortcut/application locations
3. **Identifies** shortcuts containing `--remote-debugging-port=XXXX`
4. **Creates backups** before modifying any files
5. **Removes** the CDP port argument
6. **Reports** summary of changes made

## Examples

### Remove CDP Port from Cursor IDE

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File windows.ps1 -IDEName "Cursor"
```

**Linux:**
```bash
./linux.sh cursor
```

**macOS:**
```bash
./mac.sh Cursor
```

### Remove CDP Port from Antigravity IDE

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File windows.ps1 -IDEName "Antigravity"
```

**Linux:**
```bash
./linux.sh antigravity
```

**macOS:**
```bash
./mac.sh Antigravity
```

### Remove CDP Port from VS Code

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File windows.ps1 -IDEName "Code"
```

**Linux:**
```bash
./linux.sh code
```

**macOS:**
```bash
./mac.sh "Visual Studio Code"
```

## Safety Features

- ✅ **Automatic backups** created before modifications
  - Windows: `*.lnk.bak`
  - Linux: `*.desktop.bak`
  - macOS: `*.plist.bak`, `*.bak`
- ✅ **Non-destructive**: Only removes CDP port arguments
- ✅ **Detailed reporting**: Shows before/after for each change

## Troubleshooting

### Windows: "Execution Policy" Error

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Linux/Mac: "Permission Denied"

```bash
chmod +x linux.sh  # or mac.sh
```

### No Shortcuts Found

- Verify the IDE name is correct
- Check if IDE is installed
- Try searching manually in the locations listed above
- IDE might use a different name (e.g., "Code" for VS Code)

### Changes Not Taking Effect

- **Completely quit and restart** the IDE
- On macOS, use `killall [IDE name]` to ensure it's fully closed
- On Linux, check for background processes with `ps aux | grep [IDE name]`

## Restoring Backups

If you need to restore original shortcuts:

**Windows:**
```powershell
# Replace .lnk with .lnk.bak content
Copy-Item "path\to\shortcut.lnk.bak" "path\to\shortcut.lnk" -Force
```

**Linux/Mac:**
```bash
cp /path/to/file.desktop.bak /path/to/file.desktop
# or
cp /path/to/Info.plist.bak /path/to/Info.plist
```

## Notes

- These scripts are designed for **removing** CDP ports, not adding them
- Scripts search intelligently to minimize system impact
- Compatible with IDEs that use Electron or Chromium (most modern IDEs)
- Works with Snap, Flatpak, and native installations on Linux

## License

Free to use and modify for any purpose.
