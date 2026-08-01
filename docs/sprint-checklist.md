# Fil One 90-Day Direct and Channel Sales Sprint

> Checked-in reviewed snapshot of the parent-workspace source used during the
> July 31 consolidation. Source SHA-256 before repository formatting:
> `49cb4d84262e745e761882c82e8018f5d5d7cf82eab2f530becc4c6a55d83097`.

**Sprint dates:** August 3 to October 30, 2026  
**Operating mode:** Founder-led, weekly decisions, short feedback loops  
**Primary sales play:** Secondary object storage for backup, archive, and
data-heavy workloads where predictable billing and low-cost retrieval matter.
Sell Object Lock, write once, read many (WORM), or regulatory retention only in
provider regions with current conformance evidence.

Fil One will use direct sales for strategic accounts and product learning. Fil
One will use partners to extend regional coverage without building a large
direct-sales team.

## Day 90 outcome

- Self-serve buyers can activate, test, pay, and recover data without founder
  help.
- Small and medium-sized business (SMB) and enterprise buyers receive one
  package with current commercial, technical, security, and legal information.
- Backup and recovery has a tested offer, demo, proof-of-concept (POC) package,
  and partner kit. Immutable-backup claims appear only after conformance tests
  pass.
- Fil One approves or stops the Spain pilot after confirming a named funded
  workload, operator terms, unit economics, architecture, processor roles, and
  an evidence plan. If approved, Fil One targets an operating pilot by
  October 30. Counsel approves any use of "sovereign."
- The United Kingdom (UK) has an isolated POC environment for qualified partner
  opportunities.
- Fil One targets at least two launch partners that complete training, register
  a qualified opportunity, and reach a customer test or paid order.
- The October 30 scorecard identifies the use case and sales route that deserve
  the next quarter's time and money.

## Release gates

- Public claims and technical documentation must use one approved answer for
  regions, Amazon Simple Storage Service (S3) support, Object Lock, encryption,
  key ownership, deletion, Proof of Data Possession (PDP), performance,
  durability, pricing, and audit status. [1][2][3][4][5][13][18]
- Object Lock and named integration claims require current evidence for the
  specific provider, region, product version, and configuration.
- PDP is the current Spain architecture. Exclude legacy miner, sealing,
  collateral, slashing, and storage-deal assumptions unless the selected
  operator documents a live dependency.
- A single Spanish site carries no failover claim. Fil One must provide two
  tested failure domains or state the single-site exposure and tested recovery
  time.
- Security material must describe deployed controls and test evidence. Design
  documents and planned architecture must be labeled as such.
- Shared enterprise logins are prohibited. Until organizations and roles ship,
  business POCs use isolated accounts, named keys, explicit restrictions, and
  documented access.

## Current Fil One audit findings

- Region names and availability differ across the website and technical
  documentation. [1][2]
- "Fully S3-compatible" is broader than the documented operation, addressing,
  policy, lifecycle, notification, and account support. [1][2]
- The backup page and Object Lock documentation describe different current
  feature states. Named backup-tool claims need versioned test evidence. [4]
- "Your data, your keys" can imply customer-managed server-side keys. The
  documentation describes Fil One-managed server-side keys and optional
  customer-side encryption. [3]
- The documentation describes single-user accounts and deletion behavior that
  needs one customer-facing explanation for access, logical deletion, PDP
  removal, replicas, and any archive persistence. [2][5][13]
- Pricing minimums, trial limits, egress treatment, and regional availability
  need one answer across billing and marketing pages. [1][5]
- `status.fil.one` did not resolve during the July 30 review. Public wording
  must also distinguish a SOC 2 Type II examination from ISO 27001
  certification.

## Priority and ownership

**P0:** Revenue or truth gate for the first 30 days.  
**P1:** Required to close and support the next five deals.  
**P2:** Build only after a buyer or producing partner creates the need.  
**Directly responsible individual (DRI):** One owner per line item.

At kickoff, reclassify any P0 that lacks a current buyer, a scheduled
counterparty meeting, a public-claim risk, or a first-30-day revenue dependency
as P1.

## 1. Launch control and sales truth

| Done | Pri | Deliverable                          | Definition of done                                                                                                                                                                                                                                                                                                                                                            | Due                                                          | DRI |
| ---- | --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --- |
|      | P0  | Launch decision sheet                | Hold the founder and channel whiteboard session with James. Record the sales play, partner cohort, bookings, pipeline, margin, POC, producing-partner and reference targets, engineering interruption rule, stop list, budget, and one DRI for every P0 item.                                                                                                                 | Aug. 3                                                       |     |
|      | P0  | Claims register and corrections      | Record evidence, approved wording, owner, and review date for regions, S3 support, durability, integrity, encryption, key control, Object Lock, WORM, performance, integrations, limits, egress, savings, capacity, service levels, audits, certifications, and pricing. Correct the website, app, docs, decks, calculator, security packet, scripts, and partner files. [18] | Register Aug. 3; corrections Aug. 4                          |     |
|      | P0  | Live status page and domain decision | Fix `status.fil.one` and publish component status, maintenance notices, and incident history. Investigate malicious-domain reports. Decide whether to acquire `filone.com` or `filone.io` after the cause and redirect plan are known.                                                                                                                                        | Status Aug. 5; investigation Aug. 7; domain decision Aug. 14 |     |
|      | P0  | CRM sales pipeline                   | Open one customer relationship management (CRM) pipeline with fixed stages, qualification fields, entry and exit evidence, buyer roles, expected storage, transaction route, next step, and date. Load every named account, partner, and opportunity.                                                                                                                         | Aug. 5                                                       |     |
|      | P0  | Team email and deliverability        | Give every team member a working `@fil.one` address and standard signature. Configure monitored sales, partner, security, and support inboxes. Verify Sender Policy Framework (SPF), DomainKeys Identified Mail (DKIM), Domain-based Message Authentication, Reporting, and Conformance (DMARC), forwarding, CRM capture, and deliverability.                                 | Aug. 7                                                       |     |

## 2. Offer, pricing, and product readiness

| Done | Pri | Deliverable                             | Definition of done                                                                                                                                                                                                                                                                                                                                                                               | Due                                  | DRI |
| ---- | --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | --- |
|      | P0  | Offer and stock-keeping unit (SKU) book | Publish and configure pay-as-you-go, annual business, enterprise committed capacity, and managed service provider (MSP) or embedded offers. State measurement, minimums, trial limits, egress, regions, support, migration, invoicing, overage, payment failure, cancellation, and deletion.                                                                                                     | Self-serve Aug. 7; full book Aug. 14 |     |
|      | P0  | Margin model and order tests            | Model raw and fast storage, replicas, metadata, PDP compute, applicable onchain payment operations, network, support, POC cost, discounts, channel and marketplace fees, taxes, collections, refunds, price floor, and approval authority. Pass self-serve, direct, and partner order-to-entitlement tests. [13]                                                                                 | Aug. 14                              |     |
|      | P0  | Product availability matrix             | Publish tested S3 application programming interface (API) operations, addressing modes, software development kit versions, backup tools, limits, errors, regions, physical location, placement, replication, residency, support, and current versus planned features.                                                                                                                            | Aug. 7                               |     |
|      | P0  | Object Lock release gate                | Archive conformance, deletion, audit, time-control, lifecycle, retention-policy, and service-termination evidence for every provider, region, and release. Approve immutable selling or remove WORM and immutable claims and sell general secondary storage.                                                                                                                                     | Aug. 14                              |     |
|      | P1  | Business account availability sheet     | Verify multi-factor authentication (MFA), prohibit shared logins, and define isolated-account administration and deletion certificates. Label organization accounts, role-based access control (RBAC), single sign-on (SSO), System for Cross-domain Identity Management (SCIM), audit export, network controls, customer-managed keys, and MSP functions as current, committed, or unavailable. | Boundary Aug. 14; roadmap Aug. 21    |     |
|      | P1  | Technical proof package                 | Publish performance, integrity, PDP proof continuity, replicas, failure domains, repair assumptions, customer restore results, and provider recovery of metadata, keys, chain access, and payment operations. Record recovery point objective (RPO), recovery time objective (RTO), test date, and limits. [13]                                                                                  | Sep. 11                              |     |

## 3. Security, legal, and procurement

| Done | Pri | Deliverable                              | Definition of done                                                                                                                                                                                                                                                                                                                                                                                                                           | Due                                                      | DRI |
| ---- | --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --- |
|      | P0  | Fil One security packet                  | Publish the executive brief, architecture and data flow, shared responsibility, tenant isolation, identity and MFA, encryption and keys, logging, monitoring, secure development, vulnerability management, personnel access, incident response, continuity, deletion, regions, subprocessors, provider recovery, audit status, insurance, and contacts from one evidence base. Send Data Vortex its encryption and data-protection extract. | Data Vortex and meeting version Aug. 5; v1 Aug. 14       |     |
|      | P1  | Trust center and questionnaires          | Open the gated evidence folder and public trust center. Add the Cloud Security Alliance (CSA) Consensus Assessments Initiative Questionnaire (CAIQ), common answers, document version, owner, review date, claims link, evidence, and open gap. Use Wasabi and Backblaze as object-storage benchmarks. [7][10][22][23]                                                                                                                       | Folder Aug. 14; trust center Aug. 28                     |     |
|      | P1  | Audit readiness and security policy pack | Confirm the System and Organization Controls (SOC) 2 Type II firm, scope, observation period, owner, and report target, and the International Organization for Standardization (ISO) 27001 body, scope, and target. Start an independent penetration test. Approve incident, breach, vulnerability, continuity, recovery, and maintenance procedures, and run one tabletop exercise.                                                         | Confirm Aug. 21; procedures Sep. 4; test summary Sep. 18 |     |
|      | P0  | Customer legal package                   | Put the mutual nondisclosure agreement (NDA), Master Services Agreement (MSA), order form, service-level agreement (SLA), support policy, Data Processing Addendum (DPA), security addendum, Acceptable Use Policy (AUP), privacy policy, and subprocessor schedule in the electronic-signature system. Complete European Union and United Kingdom transfer terms and the upstream provider flow-down review with counsel. [8]               | NDA Aug. 7; full package Aug. 28                         |     |
|      | P1  | Vendor viability packet                  | Publish entity, finance, insurance, provider concentration, continuity, export, operator failure, insolvency, deletion, liability, data loss, security, audit, indemnity, service credits, termination, and approval positions. Add a software bill of materials (SBOM) and scan evidence when a buyer or auditor requires them. [14]                                                                                                        | Core packet Aug. 21; evidence by request                 |     |

## 4. Sales materials, website, and proof

| Done | Pri | Deliverable                   | Definition of done                                                                                                                                                                                                                                                                                                                                                           | Due                                               | DRI |
| ---- | --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --- |
|      | P0  | Sales kit                     | Release the Fil One pitch deck, executive one-pager, and product data sheet. Cover buyer problem, supported workloads, price, verified architecture, migration, proof, security, regions, tested S3 scope, limits, POC, and next step. Ask Chris Rocco to lead design and production.                                                                                        | Meeting version Aug. 5; v1 Aug. 14                |     |
|      | P0  | Backup and recovery kit       | Release the internal sales play, customer solution brief, and 15-minute demo from one qualification and claims record. Include tested tools and versions, restore results, Object Lock status, recovery targets, migration, pricing, POC, limits, and the account-to-retrieval demo script.                                                                                  | Aug. 14                                           |     |
|      | P1  | Enterprise pack               | Release sales-kit appendices for architecture, committed capacity, migration, AI datasets, and media/archive. Include data flow, controls, volume bands, term, overage, capacity assurance, support, rollback, ordering, qualification, proof, and pricing examples. Link technical claims to the security packet.                                                           | Aug. 21 to Aug. 28                                |     |
|      | P1  | Competitive and proof library | Compare Amazon Web Services (AWS) S3, Wasabi, Backblaze B2, and Cloudflare R2 on the same workload. Add approved answers for Filecoin, vendor, deletion, security, support, and exit questions, plus request-for-proposal (RFP) answers and two customer-approved proof briefs with volume, migration, restore, performance, support, and savings.                           | Library Aug. 21; proof briefs Sep. 25 and Oct. 23 |     |
|      | P1  | Website and social launch     | Build three website paths: Start free, Plan a workload migration, and Become a launch partner. Add proof pages and limits, and instrument activation through payment and sales handoff. Update the Fil One company page and team profiles. Prepare six posts for RW's reported 6,300-follower audience. RW approves and sends personal outreach; Meredith may draft it. [19] | Website Aug. 28; LinkedIn Aug. 14                 |     |

## 5. Direct sales, POCs, and customer success

| Done | Pri | Deliverable               | Definition of done                                                                                                                                                                                                                                                                                                                                    | Due                                | DRI |
| ---- | --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --- |
|      | P1  | Buyer and target matrix   | Score 25 direct accounts and 10 channel targets, and complete 10 buyer or partner interviews. Record workload, buyer, incumbent, storage, egress, security need, disqualifier, objections, proof, purchase process, and next meeting.                                                                                                                 | Aug. 14                            |     |
|      | P1  | Enterprise sales playbook | Put discovery, numeric qualification thresholds, buyer map, mutual action plan, technical test, security, legal, procurement, order, migration, production date, and final signer into the CRM. Launch account-specific outreach with one proof item and one next step.                                                                               | Playbook Aug. 14; outreach Aug. 17 |     |
|      | P0  | POC package               | Put qualification, authorization, permitted-data rules, success tests, commercial range, isolated account, named keys, caps, logging, expiry, support owner, kickoff, midpoint review, final report, and proposal before expiry into operation. Track cost and engineering time. Add verified results to the proof library within five business days. | Aug. 21                            |     |
|      | P1  | Customer success workflow | Configure self-serve messages, business-upgrade alerts, account setup, first upload, restore, migration, severity definitions, response targets, after-hours contact, escalation, incident communication, 30-day review, expansion, and reference-rights requests.                                                                                    | Aug. 28                            |     |

## 6. Channel program and partner operations

| Done | Pri | Deliverable                            | Definition of done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Due                                        | DRI |
| ---- | --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --- |
|      | P0  | Partner program, terms, and deal rules | Publish one program guide and partner agreement for referral or agent and reseller or MSP paths. Define eligibility, target deal, activation, registration data, decision time, protection, house and prior deals, sourced and influenced credit, direct contact, pricing parity, economics, merchant of record, renewals, expansion, disputes, exit, channel costs, and price floor. Add technology partners after a tested integration. [17]                                                                                                                                   | Aug. 14                                    |     |
|      | P1  | Partner hub                            | Open the access-controlled hub with contacts, meeting files, and request forms. Add approved materials, registration, guarded standard quotes, nonstandard quote requests, sandboxes, training, and support by August 21. Add opportunity and contract status by September 4. Use existing tools.                                                                                                                                                                                                                                                                                | Aug. 7; Aug. 21; Sep. 4                    |     |
|      | P1  | Partner enablement                     | Release the partner layer of Sales Kit v1: discovery, qualification, pricing, calculator, approved claims, POC, legal forms, escalation, co-brandable backup campaign, regional POC capacity, isolated sandboxes, sales and technical training, recordings, office hours, and knowledge check. [21][22][23]                                                                                                                                                                                                                                                                      | Aug. 21 to Aug. 28                         |     |
|      | P1  | Jon Luetgers system review             | Meet Jon Luetgers to document the requirements for channel operations, quoting, contracting, provisioning, billing, attribution, commissions, renewals, cancellations, support, and reporting. Compare a contract with Jon against building and implementing the system in-house, which James wants to explore. Test the selected self-serve, direct, and partner flows end to end. James records the decision. Start distributor agreements, cloud-marketplace work, or market development funds (MDF) when a qualified buyer or producing partner requests that route. [9][11] | Meeting Aug. 7; decision and tests Aug. 14 |     |

## 7. Spain, United Kingdom, and named partners

| Done | Pri | Deliverable                           | Definition of done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Due                                                                                                           | DRI |
| ---- | --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --- |
|      | P0  | Bonum Spain meeting                   | Give Jose Pinar and Bonum the deck before August 6. Use a Spain account worksheet to record named workloads, customer access, required location, expected storage, Bonum's role, Ingram Micro's role, node economics, and dated technical and commercial meetings.                                                                                                                                                                                                                                                                       | Deck Aug. 5; meeting Aug. 6                                                                                   |     |
|      | P0  | Spain PDP storage-provider node       | Approve or stop the node after reviewing the funded workload, operator, facility, insurance, storage, replicas, metadata, PDP compute, payments, network, monitoring, staffing, capacity, migration, retention, recovery, exit, processor roles, architecture, evidence, and counsel-reviewed claims. If approved, stage and test the node. Start the pilot with a signed workload. Assess Spain's National Security Framework (Esquema Nacional de Seguridad, ENS) when a buyer requires it. [12][13]                                   | Economics Aug. 14; decision Aug. 21; architecture Sep. 11; staging Oct. 2; test Oct. 16; pilot target Oct. 30 |     |
|      | P0  | UK POC and partners                   | Isolate the United Kingdom POC with named keys, a capacity cap, support rota, security rules, expiry, and verified residency language. Ask Qubi and Viadex about buyer interest, funding, Amazon Web Services backup positioning, the Mobile Broadband Network Limited opportunity, and other pipeline. Record buyer access, workload, security owner, commercial range, and purchase date.                                                                                                                                              | Meeting by Aug. 14; environment Aug. 21                                                                       |     |
|      | P1  | United States (US) partner activation | Brief Bridgepointe and confirm its seller reach. Ask TenrecX to confirm its interest, advisor reach, reported former SHI International leadership experience, and Storj relationship. Ask Cambridge Computer whether it would consider Fil One for Neo Cloud. Record named accounts, technical owner, proof need, and next customer meeting.                                                                                                                                                                                             | Bridgepointe Aug. 21; TenrecX Aug. 28; Cambridge Sep. 4                                                       |     |
|      | P1  | Regional account plans                | Put Ingram Micro, Telarus, Ancero, and Living Rock on dated plans. Confirm an Ingram Spain and United Kingdom order route, Telarus requirements, Ancero accounts, and Living Rock's countries, entity, currency, support language, and transaction route. Book United Kingdom travel after a partner signs and provides qualified meetings. Book Spain travel for September or October after Bonum and Ingram meetings are scheduled. Send the Fil One welcome box and swag within two business days of a launch-partner signature. [20] | Account plans Sep. 11; Ingram route Sep. 18; travel decision Sep. 4                                           |     |

## 8. Revenue operations and founder cadence

| Done | Pri | Deliverable                  | Definition of done                                                                                                                                                                                                                                                                                                                            | Due                                                      | DRI |
| ---- | --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --- |
|      | P1  | Weekly scorecard             | Track self-serve conversion, paid accounts, stored capacity, direct pipeline, POC conversion, producing partners, partner pipeline, margin, service performance, restore results, support, capacity, and regional cost. Add product-qualified lead alerts and reconcile CRM, billing, usage, attribution, commissions, and margin.            | Scorecard Aug. 21; alerts Sep. 4; reconciliation Oct. 23 |     |
|      | P1  | Founder cadence and capacity | Hold the 20-minute daily blocker review, twice-weekly deal review, and weekly product, security, and partner review. Record decisions, owners, and dates. Assign internal owners or contractors for solution engineering, security and compliance, sales operations, channel operations, design, and counsel based on the dated deliverables. | Aug. 3 to Oct. 30                                        |     |
|      | P1  | Next-quarter operating plan  | Set the next-quarter sales play from conversion, margin, partner production, buyer proof, win-loss findings, and product fit. Complete the plan before adding sales headcount.                                                                                                                                                                | Oct. 30                                                  |     |

## Source notes and research reference points

1. Fil One homepage, pricing, enterprise, partner, and regional claims:
   https://www.fil.one/ ; https://www.fil.one/pricing ;
   https://www.fil.one/enterprise ; https://www.fil.one/partners
2. Fil One S3 compatibility, buckets, API addressing, and limits:
   https://docs.fil.one/reference/s3-compatibility ;
   https://docs.fil.one/storage/buckets ;
   https://docs.fil.one/reference/overview ; https://docs.fil.one/limits
3. Fil One encryption and authentication documentation:
   https://docs.fil.one/security/encryption ;
   https://docs.fil.one/security/authentication
4. Fil One backup and disaster recovery page and Object Lock documentation:
   https://www.fil.one/solutions/enterprise-backup ;
   https://docs.fil.one/storage/object-lock
5. Fil One FAQ, trial, deletion, and account model: https://docs.fil.one/faq ;
   https://docs.fil.one/billing/trial
6. National Institute of Standards and Technology Cybersecurity Framework 2.0:
   https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20
7. Cloud Security Alliance Consensus Assessments Initiative Questionnaire v4.1:
   https://cloudsecurityalliance.org/artifacts/star-level-1-security-questionnaire-caiq-v4-1
8. European Commission guidance on processors and Standard Contractual Clauses:
   https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en
   ;
   https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/new-standard-contractual-clauses-questions-and-answers-overview_en
9. Amazon Web Services Marketplace Channel Partner Private Offers:
   https://docs.aws.amazon.com/marketplace/latest/userguide/channel-partner-offers.html
10. Wasabi Trust Center: https://wasabi.com/company/trust-center
11. Microsoft Marketplace channel-led sales:
    https://learn.microsoft.com/en-us/partner-center/marketplace-offers/private-offers-for-channel
12. Spain National Security Framework, Royal Decree 311/2022:
    https://www.boe.es/buscar/act.php?id=BOE-A-2022-7191
13. Filecoin Onchain Cloud and Proof of Data Possession:
    https://docs.filecoin.cloud/core-concepts/pdp-overview/ ;
    https://docs.filecoin.cloud/core-concepts/architecture/ ;
    https://docs.filecoin.cloud/developer-guides/storage/storage-costs/ ;
    https://docs.filecoin.cloud/core-concepts/storage-providers/ ;
    https://fil.org/blog/introducing-proof-of-data-possession-pdp-verifiable-hot-storage-on-filecoin
14. Cybersecurity and Infrastructure Security Agency software bill of materials
    resource library:
    https://www.cisa.gov/topics/cyber-threats-and-advisories/sbom/sbomresourceslibrary
15. European Union Data Act, including cloud switching and international-access
    transparency:
    https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32023R2854
16. Bessemer Venture Partners on founder-led selling and developer-centric
    enterprise sales:
    https://www.bvp.com/atlas/the-founders-playbook-for-scaling-to-1-million-arr
    ;
    https://www.bvp.com/atlas/explainer-how-to-approach-enterprise-sales-at-a-developer-centric-company
    ;
    https://www.bvp.com/atlas/introducing-enterprise-sales-to-a-product-led-growth-organization
17. Object-storage channel examples from Backblaze and Storj:
    https://www.backblaze.com/partners/roles/channel ;
    https://www.backblaze.com/partners/roles/msp ;
    https://www.storj.io/legal/channel-program-terms
18. Federal Trade Commission advertising-substantiation policy:
    https://www.ftc.gov/legal-library/browse/ftc-policy-statement-regarding-advertising-substantiation
19. LinkedIn User Agreement: https://www.linkedin.com/legal/user-agreement
20. Telarus supplier criteria and current application path:
    https://www.telarus.com/become-a-supplier-form/ ;
    https://explore.telarus.com/Become-a-Supplier---Request-Form---Website_Landing-Page.html
21. Impossible Cloud partner materials and partner proof:
    https://www.impossiblecloud.com/become-a-partner ;
    https://www.impossiblecloud.com/case-study/how-cloud-factory-gets-partners-live-on-impossible-cloud-in-under-10-seconds
    ; https://www.impossiblecloud.com/magazine/channel-partner-object-storage
22. Wasabi security and channel materials:
    https://wasabi.com/cloud-object-storage/security ;
    https://wasabi.com/partner/become-a-partner/systems-integrators
23. Backblaze compliance, security, solution, and partner materials:
    https://www.backblaze.com/cloud-storage/compliance ;
    https://www.backblaze.com/docs/cloud-storage-security ;
    https://www.backblaze.com/cloud-storage/b2-neo ;
    https://www.backblaze.com/cloud-storage/solutions/backup-and-archive ;
    https://www.backblaze.com/cloud-storage/b2-reserve ;
    https://www.backblaze.com/partners

**Planning boundary:** Legal, regulatory, audit, certification, and
data-sovereignty statements require review by the appropriate counsel, auditor,
or qualified security specialist before Fil One publishes or contracts them.
