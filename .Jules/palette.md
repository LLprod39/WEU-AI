## 2024-06-23 - Accessibility fixes for SVG icon-only buttons
**Learning:** This app's SVG icon-only buttons lacked ARIA labels on the `<button>` parent and had visible nested `<svg>` tags. For screen reader clarity, a `<button>` containing only an `<svg>` needs an `aria-label` while the child `<svg>` needs `aria-hidden="true"` to prevent screen readers from reading arbitrary markup.
**Action:** When creating new interactive icons using SVG, strictly follow this pattern: wrap `<svg>` in a `<button aria-label="Action Name">` and add `aria-hidden="true"` to the `<svg>` itself.
