# Components Skill

This file teaches language models how to use the UI component library correctly.

## Card

Use `Card` to group a small section of UI such as dashboard widgets, settings blocks, or lists.

### Props

- `title?: string`
- `headerMeta?: ReactNode`
- `footer?: ReactNode`
- `footerAlign?: "left" | "center" | "right"` (default: `"right"`)
- `children: ReactNode`

### Rules

- If `title` is provided, it always renders at the top of the card.
- If `headerMeta` is provided, it renders on the right side of the header row.
- If `footer` is provided, it always renders at the bottom of the card.
- Do not add another heading for the title inside the card body.

### Examples

```tsx
import Card from "../components/Card.js";
import Button from "../components/Button.js";

<Card
  title="API key"
  headerMeta={<span className="status-pill success">Installed</span>}
  footer={<Button type="button">Save key</Button>}
>
  <p className="muted">Required for discovery and generation.</p>
</Card>
```

```tsx
import Card from "../components/Card.js";

<Card>
  <p>Untitled content block.</p>
</Card>
```

```tsx
import Card from "../components/Card.js";
import Button from "../components/Button.js";

<Card
  title="Review"
  footerAlign="left"
  footer={<Button type="button" variant="secondary">Cancel</Button>}
>
  <p>Confirm the changes below.</p>
</Card>
```

## Button

Use `Button` for all user actions. Do not use raw `<button>` elements.

### Variants

- `primary`: main action
- `secondary`: supporting action
- `tertiary`: low-priority or inline action
- `icon`: icon-only action

### Props

- `variant?: "primary" | "secondary" | "tertiary" | "icon"`
- `icon?: ReactNode`
- `disabled?: boolean`

### Rules

- Use `disabled` for disabled state, not a variant.
- Icon buttons must include `aria-label`.

### Examples

```tsx
import Button from "../components/Button.js";

<Button type="button" variant="primary">Start discovery</Button>
```

```tsx
import Button from "../components/Button.js";

<Button type="button" variant="secondary">Cancel</Button>
```

```tsx
import Button from "../components/Button.js";

<Button type="button" variant="tertiary">Install new key</Button>
```

```tsx
import Button from "../components/Button.js";

const DownArrowIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 4v12m0 0l-5-5m5 5l5-5"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

<Button
  type="button"
  variant="icon"
  icon={DownArrowIcon}
  aria-label="Scroll to bottom"
/>
```

```tsx
import Button from "../components/Button.js";

<Button type="button" disabled>Save</Button>
```

## ChatBubble

Use `ChatBubble` to render chat messages with a role header and markdown body.

### Props

- `role?: "user" | "assistant"` (default: `"assistant"`)
- `kind?: "message" | "tool"` (default: `"message"`)
- `status?: "running" | "done" | "error"`
- `toolName?: string`
- `toolMeta?: string`
- `content?: string`
- `children?: ReactNode`

### Rules

- Prefer `content` for normal messages; it renders markdown.
- Use `children` only when you need custom rendering (e.g. selection highlights).
- The bubble header shows the role automatically.
- For tool messages, set `kind="tool"` and provide `toolName`/`toolMeta`.

### Examples

```tsx
import ChatBubble from "../components/ChatBubble.js";

<ChatBubble role="assistant" content="**Summary**\n\n- Step one\n- Step two" />
```

```tsx
import ChatBubble from "../components/ChatBubble.js";

<ChatBubble kind="tool" toolName="read_file" toolMeta="path=src/App.tsx" status="running" />
```

```tsx
import ChatBubble from "../components/ChatBubble.js";

<ChatBubble role="user" content="Please add a sidebar." />
```

## Accessibility

- Always include `aria-label` on icon-only buttons.
- Use `<Link>` for navigation and `Button` for actions.

## Do / Don't

**Do**

- Use `Card` to group a section of UI.
- Use `Button` for every action.

**Don't**

- Put card titles below the card body.
- Use a variant to indicate disabled state.
