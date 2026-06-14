## 2026-06-14 - ARIA attributes on nested SVGs inside buttons
**Learning:** Adding `aria-label` to a parent `<button>` provides the accessible name, but the inner `<svg>` might still be parsed by some screen readers if not explicitly hidden, creating redundant or confusing announcements.
**Action:** Always append `aria-hidden="true"` to inner `<svg>` or `<span class="material-icons-round">` elements when adding `aria-label` to an icon-only parent button.
