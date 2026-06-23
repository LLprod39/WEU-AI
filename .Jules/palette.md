## 2023-10-27 - Icon-only Buttons A11y Pattern
**Learning:** Icon-only buttons in this project's mobile templates (using Material Icons ligatures within spans) are inaccessible to screen readers by default. They read the raw ligature string instead of the button's purpose.
**Action:** Always add a localized `aria-label` to the parent `<button>` and apply `aria-hidden="true"` to the inner `<span class="material-icons-round">` for all icon-only interactions.
