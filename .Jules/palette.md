## 2024-05-20 - Missing ARIA Labels in Table Action Buttons
**Learning:** Found a recurring pattern across the app where icon-only action buttons in tables (like "Edit", "Delete", "Change Password") rely solely on `title` attributes for accessibility. Additionally, the inner `<span class="material-icons-round">` elements need `aria-hidden="true"` to hide the ligature text from screen readers.
**Action:** Always add explicit `aria-label` attributes to the parent `<button>` and `aria-hidden="true"` to the inner icon `<span>` for all icon-only buttons during UX audits.
