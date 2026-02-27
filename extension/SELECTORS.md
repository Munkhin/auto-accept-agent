# Auto Accept — Selector Reference

All CSS selectors and text patterns used by the auto-accept system. The injected script (`auto_accept.js`) uses these to find and click buttons in the IDE's Electron browser via CDP.

---

## Accept Buttons

These are the CSS selectors used to find clickable elements on the page.

| IDE | CSS Selectors |
|---|---|
| **Antigravity** | `.bg-ide-button-background`, `button.cursor-pointer`, `button` |
| **Cursor** | `button`, `[class*="button"]`, `[class*="anysphere"]` |

**How it works:** For each selector, `queryAll(selector)` traverses all documents (including iframes) and returns matching elements. Each element is then checked against the text pattern rules below.

---

## Text Pattern Matching

After finding candidate elements via CSS selectors, `isAcceptButton(el)` checks the element's `textContent` (trimmed, lowercased, max 50 chars) against these patterns:

### Accept Patterns (will be clicked)
```
accept, run, retry, apply, execute, confirm, always allow, allow once, allow
```

### Reject Patterns (never clicked — checked first)
```
skip, reject, cancel, close, refine
```

**Logic:** If text matches ANY reject pattern → skip. If text matches ANY accept pattern → candidate for clicking.

---

## Banned Command Detection

When a button's text contains `run` or `execute`, the system performs additional safety checks before clicking.

### How banned commands are detected

1. **Walk up the DOM** from the button element (up to 10 parent levels)
2. **Scan siblings** for `<pre>` and `<code>` elements (up to 5 siblings per level)
3. **Extract text** from those code elements
4. **Also check** the button's `aria-label` and `title` attributes
5. **Compare** the combined text against the banned commands list

### Elements searched for command context
```
pre, code, pre code
```

### Default banned commands
```
rm -rf /
rm -rf ~
rm -rf *
format c:
del /f /s /q
rmdir /s /q
:(){:|:&};:
dd if=
mkfs.
> /dev/sda
chmod -R 777 /
```

### Pattern matching
- **Substring match:** `commandText.toLowerCase().includes(pattern.toLowerCase())`
- **Regex support:** Patterns like `/pattern/flags` are parsed as RegExp

---

## Tab Navigation (Background Mode)

Background mode cycles through open conversation tabs. These selectors find the tab elements to click.

### Cursor Tab Selectors (tried in order until one returns results)
```css
#workbench\.parts\.auxiliarybar ul[role="tablist"] li[role="tab"]
.monaco-pane-view .monaco-list-row[role="listitem"]
div[role="tablist"] div[role="tab"]
.chat-session-item
```

### Antigravity Tab Selector
```css
button.grow
```

### New Conversation Button (opens tab panel in Antigravity)
```css
[data-tooltip-id='new-conversation-tooltip']
```

---

## Overlay Positioning

The background mode overlay anchors to the AI panel. These selectors find the panel (tried in order):

```css
#antigravity\.agentPanel
#workbench\.parts\.auxiliarybar
.auxiliary-bar-container
#workbench\.parts\.sidebar
```

If no panel is found, the overlay covers the full viewport.

---

## Completion Detection

### Task completion badges
The system looks for `<span>` elements with exact text content:
```
Good
Bad
```
When found on the current tab, the conversation is marked as completed.

### Compilation error detection
```css
.codicon-error
.codicon-warning
[class*="marker-count"]
.squiggly-error
.monaco-editor .squiggly-error
```

If errors are detected alongside a completion badge, the status is `done-errors` instead of `done`.

---

## DOM Traversal

All selectors use `queryAll(selector)` which:
1. Starts from `document`
2. Recursively enters all `<iframe>` and `<frame>` elements
3. Queries each document with `querySelectorAll(selector)`
4. Returns combined results across all frames

This ensures buttons inside IDE webview iframes are found.

---

## Adding New Selectors

To add support for a new IDE or button type:

1. **Button selectors:** Add to `getButtonSelectors()` in `auto_accept.js` (line ~186)
2. **Accept/reject text patterns:** Modify the `acceptPatterns` / `rejectPatterns` arrays (line ~58)
3. **Tab selectors:** Add to `CURSOR_TAB_SELECTORS` or `ANTIGRAVITY_TAB_SELECTOR` (lines ~819-827)
4. **Panel selectors:** Add to `PANEL_SELECTORS` array (lines ~225-230)

---

## Specific Button References

### "Always Allow" Button (Antigravity)

Appears when the agent requests tool/command permissions.

- **Text:** `Always Allow`
- **Element:** `<button>` inside a `<span class="truncate">`
- **Button selector:** `button.flex.items-center.px-3.py-1.cursor-pointer.transition-colors.rounded-l`
- **Parent wrapper:** `div.bg-primary.text-primary-foreground.rounded-sm`
- **Location:** Inside `.antigravity-agent-side-panel` → `#conversation` panel
- **Matched by:** `button.cursor-pointer` selector + `'always allow'` / `'allow'` text pattern
