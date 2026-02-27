#!/bin/bash

# Universal Mac Script to Remove CDP Port from IDE Launch Configuration
# Works for any IDE across the system

echo "=== IDE Shortcut CDP Port Remover (macOS) ==="

# Prompt for IDE name if not provided
if [ -z "$1" ]; then
    read -p "Enter IDE name (e.g., Cursor, Antigravity, Visual Studio Code): " IDE_NAME
else
    IDE_NAME="$1"
fi

echo ""
echo "Searching for $IDE_NAME configurations..."

# Define search locations
APP_LOCATIONS=(
    "/Applications"
    "$HOME/Applications"
    "/Applications/Utilities"
)

# Search for the app
app_path=""
for location in "${APP_LOCATIONS[@]}"; do
    if [ -d "$location" ]; then
        echo "Searching: $location"
        found=$(find "$location" -maxdepth 2 -name "*${IDE_NAME}*.app" -type d 2>/dev/null | head -n1)
        if [ -n "$found" ]; then
            app_path="$found"
            echo "Found: $app_path"
            break
        fi
    fi
done

if [ -z "$app_path" ]; then
    echo ""
    echo "App not found for '$IDE_NAME' in standard locations."
    echo "Please provide the full path to the .app:"
    read -p "Path: " app_path

    if [ ! -d "$app_path" ]; then
        echo "Invalid path. Exiting."
        exit 1
    fi
fi

echo ""
echo "=== Current Launch Method ==="
echo ""
echo "On macOS, Chrome DevTools Protocol (CDP) flags are typically added in three ways:"
echo ""
echo "1. Info.plist modification (permanent)"
echo "2. Launch script wrapper (semi-permanent)"
echo "3. Command-line launch (temporary)"
echo ""

# Check Info.plist for CDP arguments
info_plist="$app_path/Contents/Info.plist"
modified=false

if [ -f "$info_plist" ]; then
    echo "Checking Info.plist: $info_plist"

    # Check if CDP port is in Info.plist
    if grep -q "remote-debugging-port" "$info_plist"; then
        echo "Found CDP port configuration in Info.plist"
        echo ""

        # Create backup
        backup_plist="${info_plist}.bak"
        cp "$info_plist" "$backup_plist"
        echo "Backup created: $backup_plist"

        # Remove CDP port entries
        # This handles both plist XML formats
        if command -v plutil &> /dev/null; then
            # Use plutil if available (more reliable)
            plutil -convert xml1 "$info_plist"
            sed -i '' '/<string>--remote-debugging-port=[0-9]*<\/string>/d' "$info_plist"
            echo "CDP port arguments removed from Info.plist"
            modified=true
        else
            # Fallback to sed
            sed -i '' '/<string>--remote-debugging-port=[0-9]*<\/string>/d' "$info_plist"
            echo "CDP port arguments removed from Info.plist (using sed)"
            modified=true
        fi
    else
        echo "No CDP port found in Info.plist"
    fi
else
    echo "Info.plist not found at expected location."
fi

echo ""

# Check for launch wrapper scripts
wrapper_locations=(
    "/usr/local/bin/$(basename "$app_path" .app | tr '[:upper:]' '[:lower:]')"
    "$HOME/.local/bin/$(basename "$app_path" .app | tr '[:upper:]' '[:lower:]')"
)

echo "Checking for launch wrapper scripts..."
for wrapper in "${wrapper_locations[@]}"; do
    if [ -f "$wrapper" ]; then
        if grep -q "remote-debugging-port" "$wrapper"; then
            echo "Found CDP port in wrapper: $wrapper"

            # Create backup
            cp "$wrapper" "${wrapper}.bak"
            echo "Backup created: ${wrapper}.bak"

            # Remove CDP port
            sed -i '' 's/ --remote-debugging-port=[0-9]\+//g' "$wrapper"
            echo "CDP port removed from wrapper script"
            modified=true
        fi
    fi
done

echo ""
echo "=== Summary ==="

if [ "$modified" = true ]; then
    echo "CDP port configuration has been removed."
    echo ""
    echo "Please quit and restart $IDE_NAME for changes to take effect."
    echo ""
    echo "If you previously launched with 'open -n -a \"$IDE_NAME\" --args --remote-debugging-port=XXXX',"
    echo "you can now launch normally or use: open -a \"$IDE_NAME\""
else
    echo "No CDP port configuration found."
    echo ""
    echo "If you're launching with command-line arguments, simply stop using:"
    echo "  --remote-debugging-port=XXXX"
    echo ""
    echo "Launch normally with: open -a \"$IDE_NAME\""
fi
