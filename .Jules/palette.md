## 2026-03-19 - Add ARIA labels to icon-only buttons
**Learning:** Icon-only buttons in the settings section (e.g. edit, delete) use the 'title' attribute for tooltips but lack semantic 'aria-label' attributes, causing poor accessibility for screen reader users.
**Action:** Always ensure icon-only buttons include an 'aria-label' attribute matching their visual meaning or tooltip, and hide the inner icon element from screen readers using 'aria-hidden="true"'.
