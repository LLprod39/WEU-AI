## 2024-05-24 - Accessibility improvements
**Learning:** Found multiple icon-only buttons in `settings_access.html` without `aria-label`. They have `title` but `aria-label` is needed for screen readers. Some inner icons also lack `aria-hidden="true"`.
**Action:** Always add `aria-label` to icon-only buttons matching the `title`, and add `aria-hidden="true"` to their inner `span` icons.
