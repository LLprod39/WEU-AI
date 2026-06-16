## 2024-06-16 - Settings Access Icon Buttons ARIA Labels
**Learning:** Icon-only action buttons in UI components lacking `aria-label` tags fail accessibility guidelines. Using `title` alone isn't sufficient for screen readers. Parent elements should have the `aria-label` while inner icons must include `aria-hidden="true"`.
**Action:** Consistently add `aria-label` to parent `<button>` components and `aria-hidden="true"` to nested `<span>` elements for all newly introduced icon-only buttons.
