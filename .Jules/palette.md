## 2026-05-31 - Focus States in Custom Workspace Components
**Learning:** Custom `.pm-workspace` UI components (like `.btn-icon`) often miss native focus states because they are built outside the standard Tailwind component system, making keyboard navigation difficult.
**Action:** Always append standard Tailwind focus classes (`focus:outline-none focus:ring-2 focus:ring-primary/50`) to custom workspace components to ensure consistent keyboard accessibility across the platform.
