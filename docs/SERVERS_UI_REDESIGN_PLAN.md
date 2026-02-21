# Plan: Servers UI/UX Redesign

## Overview
Redesign the servers module UI/UX to be cleaner and more minimal, with two key features:
1. **Auto-connect** - Connect to server without entering password (if encrypted_password exists and master_password is stored in session)
2. **Minimal terminal window** - Button to open terminal+chat in a new popup window with minimal UI

## Current State Analysis

### Files to Modify
- `servers/templates/servers/list.html` - Server list page (1294 lines)
- `servers/templates/servers/terminal.html` - Terminal page (1336 lines)
- `servers/consumers.py` - WebSocket consumer (already handles auto-connect logic)
- `servers/views.py` - Add new view for minimal terminal popup
- `servers/urls.py` - Add URL for minimal terminal

### Current Issues
1. **list.html** has 5 modal windows (serverModal, editServerModal, groupModal, globalContextModal, groupContextModal) - overwhelming
2. Terminal page requires manual password input every time
3. No option to open terminal in a separate focused window
4. Too many elements visible at once

---

## Implementation Plan

### Phase 1: Server List UI Simplification

**Goal:** Reduce visual noise, consolidate modals, improve card layout

**Changes to `servers/templates/servers/list.html`:**

1. **Simplify server card** (lines 291-347):
   - Remove tags display from card (move to tooltip/edit modal)
   - Make quick-connect button always visible (not just on hover)
   - Add auto-connect indicator (lock icon if encrypted_password exists)
   - Compact the card: name + host:port + connect button + menu

2. **Consolidate action buttons:**
   - Test Connection + Edit → dropdown menu (three-dot icon)
   - Keep Connect button prominent

3. **Simplify command bar** (lines 207-269):
   - Keep: Search, Add Server
   - Move to menu: Global Context, New Group, Terminal Hub
   - Remove stats pills (online/total) - redundant

4. **Reduce modal complexity:**
   - Keep serverModal and editServerModal (essential)
   - Move Context modals to separate settings page (future)

### Phase 2: Auto-Connect Feature

**Goal:** Connect to server without password prompt if credentials are saved

**Storage:** Django Session (secure, server-side, cleared on logout/browser close)

**Backend Changes (`servers/views.py`):**

1. Add session-based master password storage:
   ```python
   @csrf_exempt
   @login_required
   @require_http_methods(["POST"])
   def set_master_password(request):
       """Store master password in session for auto-connect"""
       data = json.loads(request.body)
       mp = data.get('master_password', '')
       if mp:
           # Store in session (encrypted by Django session backend)
           request.session['_master_password'] = mp
           request.session.set_expiry(0)  # Expires when browser closes
       return JsonResponse({'success': True})

   @login_required
   def get_master_password(request):
       """Get master password from session (internal use)"""
       return request.session.get('_master_password', '')
   ```

2. Add API to check auto-connect availability:
   ```python
   @login_required
   def server_autoconnect_status(request, server_id):
       server = get_object_or_404(Server, id=server_id, user=request.user)
       has_mp = bool(request.session.get('_master_password'))
       has_enc = bool(server.encrypted_password)
       can_auto = has_mp and has_enc and server.auth_method in ('password', 'key_password')
       return JsonResponse({
           'can_autoconnect': can_auto,
           'has_session_mp': has_mp,
           'has_encrypted_password': has_enc,
           'auth_method': server.auth_method
       })
   ```

3. Modify WebSocket consumer to get MP from session:
   - Add `_get_session_master_password()` method
   - If `master_password` not in connect message, try session

**Frontend Changes (`servers/templates/servers/terminal.html`):**

1. On page load, check `/servers/api/{id}/autoconnect-status/`
2. If `can_autoconnect=true`, auto-connect without password prompt
3. Show "Enter master password once" prompt first time
4. Add checkbox "Remember for session" when entering password

**Frontend Changes (`servers/templates/servers/list.html`):**

1. Add lock icon 🔒 on server cards with `encrypted_password`
2. Add "Set master password" button in header (global for all servers)
3. Show green check ✓ when session has master password stored

**WebSocket Changes (`servers/consumers.py`):**
- Add method to retrieve master_password from session if not provided
- Requires passing session key through WebSocket scope

### Phase 3: Minimal Terminal Popup Window

**Goal:** Open terminal in a new minimal browser window (terminal + AI chat only)

**New Files:**

1. `servers/templates/servers/terminal_minimal.html` - Stripped-down terminal:
   - No navigation header
   - No breadcrumbs
   - Compact connection bar (auto-hide when connected)
   - Terminal + AI panel only
   - Server selector dropdown (to switch servers)
   - Fullscreen button

**Changes to `servers/views.py`:**

```python
@login_required
@require_feature('servers')
def terminal_minimal(request, server_id: int):
    """Minimal terminal popup - no chrome, just terminal + AI"""
    server = get_object_or_404(Server, id=server_id, user=request.user)
    servers = Server.objects.filter(user=request.user, is_active=True)
    return render(request, 'servers/terminal_minimal.html', {
        'server': server,
        'servers': servers,  # For server switcher
    })
```

**Changes to `servers/templates/servers/list.html`:**

Add "Open in new window" button to each server card:
```javascript
function openMinimalTerminal(serverId) {
    const w = 1200, h = 800;
    const left = (screen.width - w) / 2;
    const top = (screen.height - h) / 2;
    window.open(
        `/servers/${serverId}/terminal/minimal/`,
        `terminal_${serverId}`,
        `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
    );
}
```

**Changes to `servers/urls.py`:**
```python
path('<int:server_id>/terminal/minimal/', views.terminal_minimal, name='terminal_minimal'),
```

---

## UI Design Decisions

### Server Card (Simplified)
```
┌─────────────────────────────────────────────────────┐
│ 🔒 production-api-01          192.168.1.100:22      │
│    root • password auth       [Connect] [⋮]        │
└─────────────────────────────────────────────────────┘
```
- Lock icon 🔒 = auto-connect available
- Dropdown menu [⋮] = Test, Edit, Open in new window, Delete

### Terminal Page (Simplified)
- Auto-connect on load if credentials saved
- Hide password inputs when connected
- Collapsible AI panel (default expanded on desktop)

### Minimal Terminal Popup
- No header/footer
- Server dropdown selector (top-left)
- Close button (top-right)
- Terminal fills window
- AI panel (right, resizable)

---

## Files Summary

| File | Action | Changes |
|------|--------|---------|
| `servers/templates/servers/list.html` | Modify | Simplify cards, add lock icons, add "Open in window" button, MP indicator |
| `servers/templates/servers/terminal.html` | Modify | Auto-connect logic, hide inputs when connected, remember MP checkbox |
| `servers/templates/servers/terminal_minimal.html` | Create | New minimal template for popup window |
| `servers/views.py` | Modify | Add `terminal_minimal`, `set_master_password`, `autoconnect_status` |
| `servers/urls.py` | Modify | Add URLs for minimal terminal and MP APIs |
| `servers/consumers.py` | Modify | Get master_password from session if not in message |

---

## Verification

1. **Server list:**
   - Cards show lock icon for servers with saved passwords
   - Connect button works
   - "Open in new window" opens minimal terminal

2. **Auto-connect:**
   - Enter master password once
   - Check "Remember for session"
   - Subsequent connections auto-connect

3. **Minimal terminal:**
   - Opens in popup window
   - Can switch servers
   - AI chat works
   - No navigation chrome

---

## Future Improvements (Out of Scope)

- Mobile: auto-connect with biometric/PIN
- Context modals → separate Settings page
- Server groups → collapsible sidebar
