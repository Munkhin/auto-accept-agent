# Universal Windows Script to Remove CDP Port from IDE Shortcuts
# Works for any IDE across the system

param(
    [string]$IDEName = ""
)

Write-Host "=== IDE Shortcut CDP Port Remover (Windows) ===" -ForegroundColor Cyan

# Prompt for IDE name if not provided
if ([string]::IsNullOrWhiteSpace($IDEName)) {
    $IDEName = Read-Host "Enter IDE name (e.g., Cursor, Antigravity, VSCode)"
}

Write-Host "`nSearching for $IDEName shortcuts..." -ForegroundColor Yellow

# Define search locations
$searchLocations = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('DesktopDirectory'),
    "$env:USERPROFILE\Desktop",
    "$env:USERPROFILE\OneDrive\Desktop",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
    "$env:USERPROFILE\AppData\Roaming\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
)

$WshShell = New-Object -ComObject WScript.Shell
$foundShortcuts = @()

# Search for shortcuts
foreach ($location in $searchLocations) {
    if (Test-Path $location) {
        Write-Host "Searching: $location"
        $shortcuts = Get-ChildItem -Path $location -Recurse -Filter "*.lnk" -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "*$IDEName*" }
        $foundShortcuts += $shortcuts
    }
}

if ($foundShortcuts.Count -eq 0) {
    Write-Host "`nNo shortcuts found for '$IDEName'." -ForegroundColor Red
    Write-Host "Make sure the IDE name is correct and shortcuts exist." -ForegroundColor Yellow
    exit 0
}

Write-Host "`nFound $($foundShortcuts.Count) shortcut(s):" -ForegroundColor Green
$modifiedCount = 0

foreach ($shortcutFile in $foundShortcuts) {
    Write-Host "`n---" -ForegroundColor Gray
    Write-Host "Shortcut: $($shortcutFile.Name)" -ForegroundColor White
    Write-Host "Location: $($shortcutFile.FullName)" -ForegroundColor Gray

    $shortcut = $WshShell.CreateShortcut($shortcutFile.FullName)
    $originalArgs = $shortcut.Arguments

    Write-Host "Current arguments: $originalArgs" -ForegroundColor Yellow

    # Remove CDP port arguments
    if ($originalArgs -match "--remote-debugging-port=\d+") {
        # Remove the CDP port argument
        $newArgs = $originalArgs -replace "--remote-debugging-port=\d+\s*", ""
        $newArgs = $newArgs.Trim()

        $shortcut.Arguments = $newArgs
        $shortcut.Save()

        Write-Host "New arguments: $newArgs" -ForegroundColor Green
        Write-Host "Status: CDP port REMOVED" -ForegroundColor Green
        $modifiedCount++
    } else {
        Write-Host "Status: No CDP port found (no changes made)" -ForegroundColor Cyan
    }
}

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "Total shortcuts found: $($foundShortcuts.Count)"
Write-Host "Modified: $modifiedCount"
Write-Host "`nPlease restart $IDEName for changes to take effect." -ForegroundColor Yellow
