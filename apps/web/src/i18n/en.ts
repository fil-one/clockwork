export const en = {
  "app.name": "Clockwork Commerce",
  "home.eyebrow": "Commerce operations, synchronized",
  "home.title": "Every agreement, term, and payment in one dependable chain.",
  "home.description":
    "A resettable foundation is ready for direct, partner, and lifecycle implementation lanes.",
  "home.term": "Northstar annual term",
  "home.action": "Open demo action",
  "home.empty.title": "No exceptions need attention",
  "home.empty.description":
    "Pricing, legal, and credit exceptions will appear here with an owner and response target.",
} as const;

export type MessageId = keyof typeof en;
export function t(id: MessageId): string {
  return en[id];
}
