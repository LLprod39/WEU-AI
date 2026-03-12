## 2024-03-12 - Added ARIA labels to icon-only buttons
**Learning:** Icon-only buttons often lack `aria-label` which makes them unreadable for screen readers. In this application, these buttons had `title` attributes that were reused for the `aria-label`.
**Action:** When creating new icon-only buttons in templates, always ensure both `title` and `aria-label` are provided for full accessibility.
