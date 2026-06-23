1. **Analyze `core_ui/templates/mobile_app.html`**
   - Locate the `<button class="icon-btn" id="notifBtn">` and `<button class="icon-btn" id="refreshBtn">`.
   - Observe that these are icon-only buttons (`notifications` and `refresh` icons inside). They are missing `aria-label` attributes.
   - Note that they have a `title` attribute, but for better accessibility, they should have `aria-label`.

2. **Analyze `core_ui/templates/docs_ui_guide.html`**
   - Locate the `<button id="sidebar-toggle" onclick="toggleSidebar()">`.
   - Observe that this is an icon-only button (contains a `menu` icon). It is missing an `aria-label` attribute and a `title` attribute.

3. **Update `core_ui/templates/mobile_app.html`**
   - Add `aria-label="Уведомления"` to `id="notifBtn"`.
   - Add `aria-label="Обновить"` to `id="refreshBtn"`.

4. **Update `core_ui/templates/docs_ui_guide.html`**
   - Add `aria-label="Открыть меню"` (or similar) and `title="Открыть меню"` to `id="sidebar-toggle"`.

5. **Verify**
   - Use `grep` to ensure the changes were correctly applied.

6. **Pre-commit Instructions**
   - Run the pre-commit script to ensure everything checks out and verified before submitting.

7. **Submit**
   - Create a commit and push with PR details.
