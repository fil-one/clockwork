import type { DocumentKind } from "../model";

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
    bytes: 19260,
    contentHash:
      "90d70b5ebf95964cf05249812e298c91cdd64f98607b77d03044d2ccea766da1",
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
    bytes: 22254,
    contentHash:
      "e5c6acbd055c29cad970e52d8bdfd8160c02836e13d0ed907296670911d66cc7",
    pages: 3,
  },
  invoice_companion: {
    bytes: 18113,
    contentHash:
      "bb68052bf50a82c0335ea19fae08eed899995b296e17b065a416b699a6b4180c",
    pages: 2,
  },
  order_form: {
    bytes: 18695,
    contentHash:
      "25ade831ebb717ac4df1bbf4a941d0261cb43763ecde07a1efc8cf760002e42d",
    pages: 2,
  },
  partner_resale_quote: {
    bytes: 9039,
    contentHash:
      "87d2cb968c1929e2a643e4ad6e37b3f5df906fe62a8e1c1c15c5bc0e9a707036",
    pages: 2,
  },
  partner_transfer_quote: {
    bytes: 18390,
    contentHash:
      "0eb5876fc0f08643089eaf574fea9757ea27a385cd3d6a08bb2ab8c50674e4da",
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
    bytes: 18155,
    contentHash:
      "243b0f9f7c54a4592a88d08d7642832fd0adc4546bcc1f5025545a969f8f216e",
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
