# Page override: Console (all app views)

Overrides `../MASTER.md` for the internal order console. Anything not listed here follows MASTER.

| Topic | MASTER says | Override | Why |
|---|---|---|---|
| Pattern | Hero + Features + CTA | **App shell**: sidebar nav + topbar + content; bottom tab bar under 768px | Internal ops tool, not a marketing page |
| Style | Glassmorphism | **Data-dense dashboard**, glass only on sticky topbar (blur 12px) | Readability of tables and stock data |
| Mode | Light + dark | **Light default**, dark via toggle (persisted) | MASTER anti-pattern: dark mode by default |
| Heading font | Calistoga | **Inter 600/700**, tight tracking | Editorial serif clashes with dense data UI |
| Data font | (JetBrains Mono in import) | **JetBrains Mono** for refs, SKUs, money | Tabular alignment |
| Accent `#EA580C` | CTA | Used only for "Ready to ship" / attention states; primary CTA stays `#2563EB` + white (5.2:1) | `#EA580C` + black text reads as warning, not action |
| Motion | back.out stagger | Stagger with ease-out-quint `[0.22,1,0.36,1]`, no overshoot on tables; springs only for indicators | MASTER note: no overshoot on dense data |

## Tokens
- Spacing: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40
- Radius: 6 (inputs), 10 (buttons), 14 (cards), 20 (drawer)
- Motion: fast 150ms (hover/press), base 220ms (enter), slow 350ms (drawer/progress); exit faster than enter
- Status = colour + icon + label (never colour alone): Placed blue/ClipboardText, Packed amber/Package, Shipped green/Truck, Cancelled red/XCircle
- Focus: 3px ring `--ring` at 35% alpha, always visible on keyboard focus
- `prefers-reduced-motion`: Framer `MotionConfig reducedMotion="user"`, CSS animations disabled
