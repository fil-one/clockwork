import type { DocumentKind } from "../model";

export const goldenPdfs: Readonly<
  Record<DocumentKind, { bytes: number; contentHash: string; pages: number }>
> = {
  amendment: {
    bytes: 8785,
    contentHash:
      "6363e3e13962a4fd4d0429f2a3e2725342b81d82e129e77911181c282df7e40e",
    pages: 2,
  },
  commission_statement: {
    bytes: 10366,
    contentHash:
      "c2d5a3185c8f4085da43f20d1efa22eda4ec463c5959bbf58ea8b8792177e2d5",
    pages: 2,
  },
  decline_confirmation: {
    bytes: 6876,
    contentHash:
      "319368fbc4bdccb822e423b742ef4ac6461011fdd6e455c72d83ad22540354a7",
    pages: 1,
  },
  deletion_certificate: {
    bytes: 9106,
    contentHash:
      "de141393fc002e6db1f049e09f2ca0b436b4233646c10730bc471dcf20b33a93",
    pages: 2,
  },
  direct_quote: {
    bytes: 13429,
    contentHash:
      "0a913b1879b9202e60ac4d5a0afbe5c5bb98625bc044550494441ba7240db3c5",
    pages: 3,
  },
  invoice_companion: {
    bytes: 9226,
    contentHash:
      "a041233a18321f5776ce5c89eece9ea64bef0518dd4cf7ebaf422ebc8ad9915e",
    pages: 2,
  },
  order_form: {
    bytes: 9820,
    contentHash:
      "9f88ca8a43d4ccf71fc1e396ec8d4ec1720e030b10fc8806327c3d7bcdbbf02f",
    pages: 2,
  },
  partner_resale_quote: {
    bytes: 9117,
    contentHash:
      "17fdaace1498fbbaf001dcac1f4306e88488349cf1946de86b11ed78d9bf171d",
    pages: 2,
  },
  partner_transfer_quote: {
    bytes: 9501,
    contentHash:
      "88fedbc5f3765c518281e28d090307931e9e9f07eabc5ff3ced646bd8c978d09",
    pages: 2,
  },
  poc_final_report: {
    bytes: 9727,
    contentHash:
      "19d193ab4cdcad5343cf129a821a44f83037740265b9403ff1aa6818147ac6fb",
    pages: 2,
  },
  poc_summary: {
    bytes: 9697,
    contentHash:
      "1101034b0af645d7ac61fe675e90630340651ed2a873e8efc87283434bb3f347",
    pages: 2,
  },
  receipt: {
    bytes: 9294,
    contentHash:
      "b5260b1628de84791a8080512b57e2f81951def6c606cc8d640e4ad456f3a395",
    pages: 2,
  },
  reconciliation_report: {
    bytes: 34282,
    contentHash:
      "62ce3ea4a48e69e51a0a960122ea2e167f2b6916b208485b82b4cc8360f72bce",
    pages: 12,
  },
  renewal_confirmation: {
    bytes: 6818,
    contentHash:
      "7abb52ffa116daf678d92389a43a3757e54e9732b371861feb2d635a0012fdd6",
    pages: 1,
  },
  report_export: {
    bytes: 33781,
    contentHash:
      "f08e17e0d92c022b32b957e3fcb8a999c300095435f063748e91b8036302a9ac",
    pages: 12,
  },
};
