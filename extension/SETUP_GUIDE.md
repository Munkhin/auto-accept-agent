# Auto Accept Agent Setup Guide

This guide helps you enable Chrome DevTools Protocol (CDP) for Auto Accept Agent to work properly.

## Why is this needed?

Auto Accept Agent needs CDP access to automatically click "Accept" buttons in your IDE. This requires launching your IDE with the `--remote-debugging-port=9000` flag.

## Setup Instructions by Platform

### Windows

1. **Copy the setup script** from the Auto Accept setup panel
2. **Open PowerShell as Administrator**
   - Press Windows key
   - Type "PowerShell"
   - Right-click "Windows PowerShell"
   - Select "Run as Administrator"
3. **Paste and run the script**
4. **Restart your IDE completely**

The script will:
- Search for your IDE shortcuts (Desktop, Start Menu, Taskbar)
- Add the CDP flag to all shortcuts found
- Or create a new shortcut if none exist

### macOS

1. **Copy the setup script** from the Auto Accept setup panel
2. **Open Terminal**
   - Press Cmd+Space
   - Type "Terminal"
   - Press Enter
3. **Paste and run the script**
4. **Quit and restart your IDE completely**

The script will:
- Search for your IDE in /Applications
- Modify Info.plist to add CDP flag
- Create a backup before making changes

### Linux

1. **Copy the setup script** from the Auto Accept setup panel
2. **Open Terminal**
   - Press Ctrl+Alt+T or search for Terminal
3. **Paste and run the script**
4. **Restart your IDE completely**

The script will:
- Search for .desktop files in all standard locations
- Add CDP flag to Exec and TryExec lines
- Support Snap, Flatpak, and native installations

## Troubleshooting

### Windows: Script execution blocked

If you get "execution policy" error:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Mac/Linux: Permission denied

Make the script executable:
```bash
chmod +x script.sh
```

### Changes not taking effect

1. **Completely quit the IDE** (not just close windows)
2. Make sure all IDE processes are terminated
   - Windows: Check Task Manager
   - Mac: Use `killall [IDE name]`
   - Linux: Use `ps aux | grep [IDE name]`
3. **Restart the IDE** using the modified shortcut

### IDE not launching

If the IDE won't start after setup:
1. Check if CDP port 9000 is already in use
2. Try using a different port (edit the script to use 9001)
3. Restore from backup:
   - Windows: Shortcuts have .bak files
   - Mac/Linux: Look for .bak files next to modified files

### Manual Setup

If the automated script doesn't work, you can manually add the flag:

**Windows:**
1. Right-click your IDE shortcut
2. Select "Properties"
3. In the "Target" field, add at the end: ` --remote-debugging-port=9000`
4. Click OK

**Mac:**
Launch from Terminal:
```bash
open -n -a "Your IDE" --args --remote-debugging-port=9000
```

**Linux:**
Edit your .desktop file and add `--remote-debugging-port=9000` to the Exec line.

## Security Note

The CDP port is only accessible from localhost (127.0.0.1) by default, so it's safe to run on your local machine. However, be cautious when using this on shared or public networks.

## Still Need Help?

- Check [GitHub Issues](https://github.com/MunKhin/auto-accept-agent/issues)
- Open a new issue with your platform and error details
- Include the output from the setup script if possible

## Supported IDEs

- Cursor
- Antigravity
- VS Code
- Any Electron-based IDE that supports Chrome DevTools Protocol
