## 2024-03-16 - [Missing aria-labels on icon buttons]
**Learning:** Found multiple instances of icon-only buttons (such as navigation and actions) in Django templates that did not contain `aria-label` tags, breaking screen reader capabilities and failing standard accessibility tests.
**Action:** Ensure that all buttons, particularly `.icon-btn` and standalone action toggles that lack inner text, are given a descriptive `aria-label` attribute mirroring the purpose of the action.
