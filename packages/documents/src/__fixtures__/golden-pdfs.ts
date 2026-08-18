import type { DocumentKind } from "../model";

export const goldenPdfs: Readonly<
  Record<DocumentKind, { bytes: number; contentHash: string; pages: number }>
> = {
  amendment: {
    bytes: 17816,
    contentHash:
      "0a4e4dce24534c7160451370948c0727970bfc82e7c1cbb765164e094678ff83",
    pages: 2,
  },
  commission_statement: {
    bytes: 19391,
    contentHash:
      "66de69cf887b5dcfa5d098668c6bb62d96b19ed3d599edfce73395e0b21970b8",
    pages: 2,
  },
  decline_confirmation: {
    bytes: 15903,
    contentHash:
      "b9975b3a0d24ca8a1adaec471f3bb617e8a58a07322c780fe80c467316d1dc55",
    pages: 1,
  },
  deletion_certificate: {
    bytes: 18141,
    contentHash:
      "b87158e682fcee0d158b9c4864e0f767145c074308db8298314c749523ce1935",
    pages: 2,
  },
  direct_quote: {
    bytes: 22459,
    contentHash:
      "efa529d7aa9bbdb6f6004888f5c197aa5b30865979434d09ca6a0f0fe6e00f54",
    pages: 3,
  },
  invoice_companion: {
    bytes: 18264,
    contentHash:
      "4bf10c86ff2755ec6afc88a84e43d93d54aff102ea5deb763233a158ecf3adf1",
    pages: 2,
  },
  order_form: {
    bytes: 18854,
    contentHash:
      "43fbde02b72a6453f9e87b01967045a33cc9578f192dab55a7e60c0cf99e12e2",
    pages: 2,
  },
  partner_resale_quote: {
    bytes: 9117,
    contentHash:
      "17fdaace1498fbbaf001dcac1f4306e88488349cf1946de86b11ed78d9bf171d",
    pages: 2,
  },
  partner_transfer_quote: {
    bytes: 18542,
    contentHash:
      "81d42417bc5b8ca1fd9cacc471583a01b8764587a54e1a6a8e63aed28c0568fa",
    pages: 2,
  },
  poc_final_report: {
    bytes: 18773,
    contentHash:
      "2bada72745510786b85e111370177053689829e7be204ffc1753998877dac3c1",
    pages: 2,
  },
  poc_summary: {
    bytes: 18737,
    contentHash:
      "d4e21268fa215325f5c8698e8925ff899de250e8a1dcbd3c2661bd2b97f620b0",
    pages: 2,
  },
  receipt: {
    bytes: 18332,
    contentHash:
      "5455bee9220fb14b0442b35a315f7d795642060d14a898d2229c0235d879bb42",
    pages: 2,
  },
  reconciliation_report: {
    bytes: 43444,
    contentHash:
      "15c45dd02e47dab9ef790d1921e1bbfd3fc9ac195714d1352a8131f48ec6bc56",
    pages: 12,
  },
  renewal_confirmation: {
    bytes: 15843,
    contentHash:
      "14713cf0a746d566379255d986a9f8879dca3763726af496f8c5103e778a405d",
    pages: 1,
  },
  report_export: {
    bytes: 42973,
    contentHash:
      "cc251aeeef2452493ef408ec5e6015fc56921bdda950f30681aaa4ccd418f368",
    pages: 12,
  },
};
