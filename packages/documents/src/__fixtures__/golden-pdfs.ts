import type { DocumentKind } from "../model";

// Generated with the official pinned Node distribution; zlib affects PDF bytes.
export const goldenPdfRuntime = {
  node: "24.18.1",
  zlib: "1.3.1-e00f703",
} as const;

export const goldenPdfs: Readonly<
  Record<DocumentKind, { bytes: number; contentHash: string; pages: number }>
> = {
  amendment: {
    bytes: 17679,
    contentHash:
      "10e85309c8b39adf65385f9afee2f1571be98b8856d4619f0b2fb3b4082fa9b4",
    pages: 2,
  },
  commission_statement: {
    bytes: 19252,
    contentHash:
      "184b016154e001b7bc138f5f7f3bfc07da09f0643b364ea347014d572184f3fe",
    pages: 2,
  },
  decline_confirmation: {
    bytes: 15789,
    contentHash:
      "06f66f65e972f18f335a3eb743f60fc3641a38c7df2ca9ecf5a20b733bf5933e",
    pages: 1,
  },
  deletion_certificate: {
    bytes: 17992,
    contentHash:
      "04ad6574f5627eca9ff212d80a90521a54cbf5e40ba54ac5c3ba69b130d691fb",
    pages: 2,
  },
  direct_quote: {
    bytes: 22251,
    contentHash:
      "15d548544325bf0371fffd4019739f0711ca9d3b142dfe97a73736f0e1ce2845",
    pages: 3,
  },
  invoice_companion: {
    bytes: 18113,
    contentHash:
      "bb68052bf50a82c0335ea19fae08eed899995b296e17b065a416b699a6b4180c",
    pages: 2,
  },
  order_form: {
    bytes: 18694,
    contentHash:
      "b57d38037c848ff93891d28b80228888bd618f274f814a4611d0c9d75458c63c",
    pages: 2,
  },
  partner_resale_quote: {
    bytes: 8973,
    contentHash:
      "c98640b91427fe05cb465091449efa9e81cab3212e2f1b28db01f5dc046417a6",
    pages: 2,
  },
  partner_transfer_quote: {
    bytes: 18681,
    contentHash:
      "8bbad648145434d994f9a242a382260841dd668e212810abf1ab9b27c1c86ec0",
    pages: 2,
  },
  poc_final_report: {
    bytes: 18649,
    contentHash:
      "95ee7a2193b650fbcf25dcbed12c778eebefe53fd8c0daa4f6df34edfde726e9",
    pages: 2,
  },
  poc_summary: {
    bytes: 18597,
    contentHash:
      "20446fcfeb3e28ec6959d5c300d401b4ee6f4563e2ce35f4ca55a19fda37e340",
    pages: 2,
  },
  receipt: {
    bytes: 18259,
    contentHash:
      "7be31bef2dadcd2db6a4199b6863cb09f84f83a01401f66e4349e36428a4dd1b",
    pages: 2,
  },
  reconciliation_report: {
    bytes: 43116,
    contentHash:
      "c8c099a0361ce505713a8c8698a79153758f7dc82d8e9d3f83f90cb71fc5a503",
    pages: 12,
  },
  renewal_confirmation: {
    bytes: 15729,
    contentHash:
      "18a24d506521af8457b4ad0d8a04fff86ed43da77da5891fc2718050caf81319",
    pages: 1,
  },
  report_export: {
    bytes: 42653,
    contentHash:
      "7db124d29a0b2c3e8cdca3de562aeeea02ffecb81f35d71b65fb9dd3cf7bf5a3",
    pages: 12,
  },
};
