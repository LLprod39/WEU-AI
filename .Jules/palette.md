## 2025-05-25 - Missing ARIA Labels in Chat Template
**Learning:** Found a systemic lack of ARIA labels in icon-only buttons across multiple chat and mobile templates. This impacts screen reader users significantly.
**Action:** Always verify icon-only buttons have proper aria-labels and use `aria-hidden="true"` on internal SVG/span elements in this project.
