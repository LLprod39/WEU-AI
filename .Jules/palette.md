## 2024-05-02 - Icon-only buttons accessibility
**Learning:** Found several icon-only buttons missing `aria-label` attributes and properly hiding inner icons, leading to poor screen reader accessibility. Buttons like the sidebar toggle in `docs_ui_guide.html` and notification/refresh buttons in `mobile_app.html` rely entirely on visual icons.
**Action:** Adding `aria-label` attributes to icon-only buttons and `aria-hidden="true"` to the nested icon spans to ensure they are properly announced to assistive technologies.
