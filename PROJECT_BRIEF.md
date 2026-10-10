# Project Brief: Social-Commerce Order Tracker (Nigeria)

**Status:** Unvalidated hypothesis. Nothing in this document has been confirmed with customers yet.
**Date:** 2026-10-09

---

## 1. Target User

**Primary:** Solo or small-team (1–5 people) Nigerian vendors who take most orders through WhatsApp chats and Instagram DMs.

- Typical categories: fashion, beauty, food/small chops, baked goods, gadgets and accessories.
- Volume: roughly 10–150 orders per week. Low enough to manage by hand, high enough that things get missed.
- Payments: mostly bank transfer, with some POS and pay-on-delivery.
- Fulfilment: own delivery rider, a dispatch company or customer pickup.
- Tools today (assumed): WhatsApp Business, phone notes, paper notebook, maybe a spreadsheet.

**Not the initial target:** vendors who already run a Shopify or Bumpa storefront as their main sales channel, or large multi-branch retailers.

## 2. Problem Hypothesis

> Vendors who sell through chat lose money and time because order details, payment confirmations and delivery status are scattered across chat threads, bank alerts and memory.

Specific pains we *suspect* (to be tested):

- **Payment matching:** It is hard to tell which bank transfer belongs to which order, and "I've paid" claims are hard to check.
- **Lost orders:** Orders get buried in long chat threads, especially at busy times (festive seasons, sales).
- **Fulfilment confusion:** Not knowing which orders are paid but not yet sent, or sent but not delivered.
- **Customer chasing:** Time spent replying to "where is my order?" messages.
- **No overview:** No easy way to see outstanding money, pending deliveries or daily totals.

## 3. Proposed Value Proposition

> "See every order, whether it's paid and where it is, in one place, without changing how your customers buy from you."

- Customers keep ordering through WhatsApp or Instagram. Only the vendor's back office changes.
- Logging an order should take seconds, on a low-end Android phone with patchy data.
- A clear list of unpaid, paid-not-sent and sent-not-delivered orders.

## 4. Why Choose This Over the Alternatives? (Hypotheses to test)

| Alternative | What it does well | Where we *might* be better |
|---|---|---|
| **WhatsApp Business** (labels, catalog, quick replies) | Free, already in use, customers are there | Labels don't track payment amounts or totals, and status lives inside chats. There's no overview of outstanding money or pending deliveries. |
| **Spreadsheet / notebook** | Free, flexible, familiar | Slow to update on a phone and easy to fall behind on. No status views or reminders. Hard to share with a rider or assistant. |
| **Bumpa and similar commerce tools** | Storefront, inventory, invoicing, a broader business suite | *Possibly* more than a chat-first vendor needs. We could be narrower, faster to log an order and cheaper. **This needs verifying:** we have not done a detailed comparison of Bumpa's current features or pricing, and it may already solve this problem well enough. |

**Main competitive risk:** "Good enough" free habits (WhatsApp labels plus memory) and existing tools like Bumpa may leave no gap worth paying for.

## 5. Five Riskiest Assumptions

1. **The pain is real and frequent.** Vendors actually lose money or significant time to missed orders and payment confusion, rather than finding it a minor annoyance.
2. **Vendors will change their behaviour.** Busy vendors will consistently log orders in a separate tool rather than relying on chat history and memory.
3. **Existing tools leave a gap.** WhatsApp Business, spreadsheets and Bumpa (or similar) do not already solve this well enough for this segment.
4. **Willingness to pay.** Enough vendors will pay a recurring fee (for example ₦2,000–₦5,000/month, *figure untested*) and keep paying.
5. **We can reach them affordably.** We can acquire vendors cheaply through communities, referrals or Instagram rather than through expensive paid ads.

## 6. Customer Interview Questions (non-leading)

Ask about past behaviour, not hypothetical opinions about our idea. Don't mention the product until the end, if at all.

1. Walk me through the last order you received, from first message to the customer receiving it.
2. Where do you keep track of orders today? Can you show me?
3. Tell me about the last time something went wrong with an order. What happened?
4. How do you confirm a customer has paid? How long does that usually take?
5. In a typical busy week, how much time do you spend on order admin rather than selling or making products?
6. What have you tried to make managing orders easier? Why did you keep or stop using it?
7. Do you use any paid apps or tools for your business today? Which ones, and what made them worth paying for?
8. Who else helps you handle orders or deliveries, and how do you share information with them?
9. What happens during your busiest period of the year? What breaks first?
10. If you could change one thing about how you run your business day to day, what would it be?

**Signals to record:** specific stories, losses quantified in naira or hours, workarounds they have already built, and money already spent on solutions.

## 7. Minimal MVP (max 5 core features)

1. **Quick order entry:** customer name/phone, items, amount and channel (WhatsApp/IG) in under 30 seconds.
2. **Payment status:** unpaid / part-paid / paid, with amount received.
3. **Fulfilment status:** pending → dispatched → delivered (or cancelled).
4. **Status dashboard:** filtered lists (unpaid, paid-not-sent, out for delivery) plus simple daily and weekly totals.
5. **Shareable order summary:** a pre-filled text the vendor can copy into WhatsApp (order details, amount due, status).

*Before building any of this, consider a no-code or concierge test (for example a shared spreadsheet template, or manually tracking orders for 5 vendors) to test the assumptions above.*

## 8. Validation Criteria

Targets are initial proposals and should be agreed on before interviews begin.

**Phase A: Problem interviews (target: 20–30 vendors)**

| Signal | Build / continue | Change direction | Abandon |
|---|---|---|---|
| Vendors who describe a specific recent order or payment failure | ≥ 60% | 30–60% | < 30% |
| Vendors who have already built a workaround (spreadsheet, notebook, paid tool) | ≥ 40% | 20–40% | < 20% |
| Vendors already satisfied with Bumpa, WhatsApp Business or similar | < 30% | 30–50% | > 50% |

**Phase B: Concierge or prototype test (target: 10 vendors, 4 weeks)**

| Signal | Build | Change direction | Abandon |
|---|---|---|---|
| Vendors still logging orders weekly in week 4 | ≥ 6 of 10 | 3–5 | ≤ 2 |
| Vendors who pre-pay or commit to a paid plan | ≥ 3 of 10 | 1–2 | 0 |
| Vendors who refer another vendor without being asked | ≥ 2 | 1 | 0 |

**Decision rule:** Build only if the Phase B "Build" thresholds are met. If the pain is real but adoption or payment is weak, change direction (for example a different segment, a payment-matching-only tool or a spreadsheet template). If the pain itself is not confirmed in Phase A, abandon.

## 9. Out of Scope for Version 1

- Online storefront, product catalog or checkout pages
- Payment processing, payment links or bank/POS integrations
- Automatic reading of WhatsApp/Instagram messages or official API integrations
- Inventory and stock management
- Delivery or logistics partner integrations and rider apps
- Accounting, tax, payroll or expense tracking
- Customer-facing app or order-tracking portal
- Multi-branch or multi-user role permissions (beyond basic sharing)
- Analytics beyond simple totals
- iOS-specific or desktop-first design
- Marketing tools (broadcasts, loyalty, discounts)
