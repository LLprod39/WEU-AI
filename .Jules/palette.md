## 2023-10-25 - Translating ARIA labels to match UI context
**Learning:** Hardcoding accessibility labels in one language (e.g., Russian "Закрыть") when the component's immediate context or visual tooltips use another language (e.g., English "Close", "Delete") creates a confusing experience for screen reader users, who will hear mixed languages for the same action.
**Action:** Always verify the language of the surrounding component (like nearby `title` tooltips or heading text) and match the newly added ARIA labels to that language context.
