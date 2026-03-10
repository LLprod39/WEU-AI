## 2026-03-10 - Hover-only actions and Keyboard Accessibility
**Learning:** Buttons that appear only on hover (e.g., using opacity-0 and group-hover:opacity-100) become invisible traps for keyboard users because tabbing into them does not trigger the hover state visually, leaving the user guessing where their focus is.
**Action:** Whenever using hover-to-reveal patterns for actions, always include focus states (like focus:opacity-100 and focus rings) to ensure the action becomes visible when focused via keyboard navigation.
