# Publishing the Fil One list price book

[`price-books/fil-one-list-usd.json`](price-books/fil-one-list-usd.json) is the
Fil One list book in the import format: **USD
$5.99 per decimal TB-month**, no
egress, API or exit fees. It has two rates, `OBJECT_COMMIT` in `france` and
`michigan`, both at $5.99
list and $5.99 overage with a 1 TB minimum. It sets no floor, no discount
authority and no partner transfer prices. Any discount goes to the pricing
exception queue until a discount matrix is added. Before partners quote resale
or distributor deals against it, add a transfer price for each partner's
transfer tier in a new version; a partner with its own terms gets its own tier.

Price-book work needs no capability switch. `legal`, `new_business` and the
other switches can stay off. An active book prices the seller Pricing page; it
does not open quotes or orders.

## Steps

You need the `commerce_admin` role, with recent MFA.

1. Check the four values only finance can confirm: the Stripe tax code
   (`txcd_10103001`), the QuickBooks income account (`4000-Storage`), the region
   slugs (`france`, `michigan`) and the approved claim wording. If any is wrong,
   edit it in the file before pasting, or edit the rate in the draft after
   import.
2. Open `/internal/price-books`, expand **Import price-book JSON into a new
   draft**, paste the whole file and press **Validate import preview**. The
   preview should show two rates at $5.99.
3. Name the draft (for example "Fil One list USD"), choose a USD version number
   not already used, set the effective date and give an import reason. Press
   **Create imported draft**.
4. Enter a **Finance decision reason**, press **Review price-book approval**,
   then **Propose activation**.
5. On your own proposal, choose **Approve my own request** and give the reason
   (8 to 500 characters). For a past or current effective date this activates
   now. For a future date it approves a schedule, which the worker runs on that
   UTC date (see [scheduled pricing](scheduled-pricing.md)).

Activation retires any active USD book. Accepted quotes and orders keep their
prices. The published book is immutable; change prices with a new version.
