## 2025-02-12 - Accessibility: Icon-only buttons missing aria-labels
**Learning:** Many icon-only action buttons (edit, delete, settings) in administrative tables used `title` attributes for tooltips but lacked `aria-label` attributes for screen reader accessibility, resulting in meaningless interactive elements for assistive tech.
**Action:** Always ensure that icon-only buttons (`<button><span class="material-icons-round">...</span></button>`) contain an explicit `aria-label` attribute describing their action, in addition to the `title` attribute used for visual tooltips.
