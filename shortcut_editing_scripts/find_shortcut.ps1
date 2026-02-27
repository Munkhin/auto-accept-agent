$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath('Desktop')
Write-Host "Desktop Path: $DesktopPath"

$Shortcuts = Get-ChildItem "$DesktopPath\*.lnk" | Where-Object { $_.Name -like "*Antigravity*" }

if ($Shortcuts.Count -eq 0) {
    Write-Host "No Antigravity shortcut found on Desktop."
} else {
    foreach ($ShortcutFile in $Shortcuts) {
        $Shortcut = $WshShell.CreateShortcut($ShortcutFile.FullName)
        Write-Host "---"
        Write-Host "Name: $($ShortcutFile.Name)"
        Write-Host "Path: $($ShortcutFile.FullName)"
        Write-Host "Arguments: $($Shortcut.Arguments)"
        Write-Host "---"
    }
}
