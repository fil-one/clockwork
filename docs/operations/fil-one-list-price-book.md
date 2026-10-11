# Publishing the Fil One list price book

[`price-books/fil-one-list-usd.json`](price-books/fil-one-list-usd.json) is the
Fil One list book in the import format: **USD \$5.99 per TB-month**, as
published at [fil.one/pricing](https://www.fil.one/pricing) (checked 10 October
2026): no egress charge on a paid plan, subject to reasonable use, and no API or
retrieval charges. It has two rates, `OBJECT_COMMIT` in `france` and `michigan`,
both at \$5.99 list and \$5.99 overage with a 1 TB minimum. It sets no floor, no
discount authority and no partner transfer prices. Any discount goes to the
pricing exception queue until a discount matrix is added. Before partners quote
resale or distributor deals against it, add a transfer price for each partner's
transfer tier in a new version; a partner with its own terms gets its own tier.

The book has no monthly minimum: the PAYG minimum (\$5.99 a month on the same
page) belongs to the PAYG offer policy at `/internal/payg-offers`.

Price-book work needs no capability switch, so `legal`, `new_business` and the
other switches can stay off. An active book then prices the seller Pricing page.
Customer buy and quote pages show no offers, and quote and order commands are
refused, until quote creation's own switches (`new_business` and `legal`) are
on.

## Steps

You need the `commerce_admin` role, with recent MFA.

1. Check the values only finance can confirm: the Stripe tax code
   (`txcd_10103000`, the code the existing books use), the QuickBooks income
   account (`4000-Storage`), the region slugs (`france`, `michigan`) and the
   approved claim wording. If any is wrong, edit it in the file before pasting,
   or edit the rate in the draft after import.
2. Open `/internal/price-books`, expand **Import price-book JSON into a new
   draft**, paste the whole file and press **Validate import preview**. The
   preview should show two rates at \$5.99.
3. Name the draft (for example "Fil One list USD"), choose a USD version number
   not already used, set the effective date and give an import reason. Press
   **Create imported draft**.
4. Before proposing, add each rate's Fil One provider SKU, region and meter at
   `/internal/catalog` (see [catalog mappings](catalog-mappings.md)). Mappings
   can be edited only on an unproposed draft. Pricing does not need them, but
   provisioning an accepted order does: without a mapping it stops with
   `ENTITLEMENT_MAPPING_MISSING`.
5. Enter a **Finance decision reason**, press **Review price-book approval**,
   then **Propose activation**.
6. On your own proposal, choose **Approve my own request** and give the reason
   (8 to 500 characters). For a past or current effective date this activates
   now. For a future date it approves a schedule, which the worker runs on that
   UTC date (see [scheduled pricing](scheduled-pricing.md)).

Activation retires any active USD book. Accepted quotes and orders keep their
prices. The published book is immutable; change prices with a new version.
