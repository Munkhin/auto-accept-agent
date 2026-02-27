#!/bin/bash

# Universal Linux Script to Remove CDP Port from IDE Shortcuts
# Works for any IDE across the system

echo "=== IDE Shortcut CDP Port Remover (Linux) ==="

# Prompt for IDE name if not provided
if [ -z "$1" ]; then
    read -p "Enter IDE name (e.g., cursor, antigravity, code): " IDE_NAME
else
    IDE_NAME="$1"
fi

IDE_NAME_LOWER=$(echo "$IDE_NAME" | tr '[:upper:]' '[:lower:]')

echo ""
echo "Searching for $IDE_NAME shortcuts..."

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

# Function to remove CDP port from a .desktop file
remove_cdp_from_desktop_file() {
    local desktop_file="$1"
    local backup_file="${desktop_file}.bak"
    local modified=false

    # Check if CDP port exists
    if ! grep -q "remote-debugging-port" "$desktop_file"; then
        echo "  Status: No CDP port found (no changes made)"
        return 1
    fi

    # Create backup
    cp "$desktop_file" "$backup_file"
    echo "  Backup created: $backup_file"

    # Remove CDP port from Exec lines
    sed -i 's/ --remote-debugging-port=[0-9]\+//g' "$desktop_file"

    # Remove from TryExec if present
    if grep -q "^TryExec=" "$desktop_file"; then
        sed -i 's/ --remote-debugging-port=[0-9]\+//g' "$desktop_file"
    fi

    echo "  Status: CDP port REMOVED"
    return 0
}

found_count=0
modified_count=0

# Search for .desktop files
for dir in "${SEARCH_LOCATIONS[@]}"; do
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

                    # Show current Exec line
                    exec_line=$(grep "^Exec=" "$file" | head -n1)
                    echo "Current: $exec_line"

                    found_count=$((found_count + 1))

                    if remove_cdp_from_desktop_file "$file"; then
                        modified_count=$((modified_count + 1))
                        # Show new Exec line
                        exec_line=$(grep "^Exec=" "$file" | head -n1)
                        echo "New: $exec_line"
                    fi
                fi
            fi
        done
    fi
done

echo ""
echo "=== Summary ==="
echo "Total shortcuts found: $found_count"
echo "Modified: $modified_count"

if [ $found_count -eq 0 ]; then
    echo ""
    echo "No shortcuts found for '$IDE_NAME'."
    echo "Make sure the IDE name is correct and .desktop files exist."
else
    echo ""
    echo "Please restart $IDE_NAME for changes to take effect."
fi
