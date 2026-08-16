import {
  InlineNotice,
  PageHeader,
  Section,
  StatusBadge,
  Table,
} from "@clockwork/ui";

import styles from "./trust-page.module.css";
import {
  tokenDistinctivenessCeiling,
  type TrustControl,
  trustControls,
  trustGaps,
  trustIntegrations,
  trustSections,
  trustUnselectedIntegrations,
} from "./trust-register";

/**
 * Every file a control rests on, deduplicated for display. A control that
 * describes an exception cites the exception too, and the reader is being asked
 * to open all of it, so the column lists all of it.
 */
function citedPaths(control: TrustControl): readonly string[] {
  return [
    ...new Set([
      control.evidencePath,
      ...(control.alsoCites ?? []).map((citation) => citation.path),
    ]),
  ];
}

/**
 * The trust, security and compliance surface.
 *
 * It renders `trust-register.ts` and nothing else. There is deliberately no
 * prose in this file that states a fact about the product: every sentence a
 * reader could rely on comes from the register, where it is bound to a file
 * and a token that `trust-register.test.ts` reads off the working tree. The
 * only free text here is navigational -- headings, and the notices that tell
 * the reader what kind of document this is.
 *
 * THE ONE PARAGRAPH THAT IS A CLAIM, AND WHY IT IS ALLOWED TO BE. The lede
 * describes what the build checks. That paragraph used to say the build "fails
 * if the file no longer contains what the control claims", which promised a
 * semantic check nothing performed -- two invented controls citing
 * `package.json` for the token "name" passed the suite untouched. It now
 * enumerates the four checks that exist, one clause each, and then says in as
 * many words that the fit between a sentence and the code it cites is a human
 * judgement the build does not make. The distinctiveness threshold is read out
 * of `tokenDistinctivenessCeiling` rather than typed, so the number on the page
 * cannot drift from the number the suite enforces.
 *
 * Do not compress that paragraph back into one sentence. The compression is
 * what made it false the first time: any summary short enough to feel like a
 * guarantee describes a stronger check than the one that runs.
 *
 * NO PUBLICATION DATE, DELIBERATELY. The first version of this component
 * stamped a date and called it a build stamp. It was not one: `app/layout.tsx`
 * awaits `headers()` and `cookies()`, which makes every route in this
 * application server-rendered on demand, so the stamp was the clock at the
 * moment a reader loaded the page and said nothing about when the content was
 * last true. A date that looks like provenance and is not is worse on this page
 * than on any other, so it is gone and the mechanism is described instead.
 */
export function TrustPage() {
  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.column}>
        <div className={styles.intro}>
          <PageHeader
            eyebrow="Trust"
            title="Security, privacy and compliance"
            description="What this system does, stated so that you can check it."
          />
          <p className={styles.lede}>
            Every control below names a file in the product source and a piece
            of text that must appear in it. The build checks four things about
            that citation, and this is the complete list: the file exists; it
            still contains the cited text; the cited text appears in no more
            than {tokenDistinctivenessCeiling * 100} per cent of the
            repository&rsquo;s files, so that it names one implementation rather
            than being a word that occurs everywhere; and any number of two or
            more digits the control states appears somewhere in a file the
            control cites.
          </p>
          <p className={styles.lede}>
            Be precise about what that last check is worth, because it is weaker
            than it sounds. It matches a number as plain text anywhere in the
            cited file, so a match can be a coincidence -- a &ldquo;24&rdquo; in
            a control can be satisfied by an unrelated &ldquo;24&rdquo; in the
            code. It does not see a quantity written as a single digit, or
            spelled as a word, so &ldquo;rotated every ninety days&rdquo; is not
            checked at all. We tested this by writing fabricated controls
            designed to slip past it, and they did.
          </p>
          <p className={styles.lede}>
            What the build cannot check at all is whether the sentence is a fair
            description of the code it points at. A control worded loosely, or
            worded tightly around numbers the check cannot see, would pass every
            one of the four. That fit is a human judgement, made by whoever
            writes the entry and whoever reviews the change, and it is the part
            you are trusting us on rather than checking. Everything above it is
            evidence that the control is written, not evidence that anyone
            outside this company has examined it.
          </p>
          <InlineNotice
            tone="warning"
            title="This page publishes no certification, audit result or policy text."
            description="Sections below marked as requiring an external gate are things we do not have. Nothing here has been reviewed by counsel or verified by an external auditor. Ask us for the current status of anything listed under 'What this page does not claim' and you will get a date, not a document."
          />
        </div>

        {trustSections.map((section) => {
          const controls = trustControls.filter(
            (control) => control.section === section.id,
          );
          return (
            <Section
              key={section.id}
              title={section.title}
              description={section.summary}
            >
              <Table
                caption={`${section.title}: implemented controls and the source that shows each one`}
                captionHidden
                headers={["Control", "Where to check it"]}
                rowKeys={controls.map((control) => control.id)}
                rows={controls.map((control) => [
                  <span key="s" className={styles.statement}>
                    {control.statement}
                  </span>,
                  <span key="e" className={styles.evidenceList}>
                    {citedPaths(control).map((path) => (
                      <code key={path} className={styles.evidence}>
                        {path}
                      </code>
                    ))}
                  </span>,
                ])}
              />
            </Section>
          );
        })}

        <Section
          title="Third-party services this software is wired to"
          description="Named here because committed configuration names them. This is a source-tree fact and not a subprocessor schedule -- see the section below."
        >
          <Table
            caption="Third-party services named in committed configuration"
            captionHidden
            headers={["Service", "What it does", "Where to check it"]}
            rowKeys={trustIntegrations.map((integration) => integration.name)}
            rows={trustIntegrations.map((integration) => [
              integration.name,
              <span key="p" className={styles.statement}>
                {integration.purpose}
              </span>,
              <code key="e" className={styles.evidence}>
                {integration.evidencePath}
              </code>,
            ])}
          />
        </Section>

        <Section
          title="Capabilities with no vendor selected"
          description="These reach an external provider over a signed, provider-neutral HTTP contract. No vendor is named anywhere in the source, so this page names none: the choice is a deployment setting, and it is made under the gate shown."
        >
          <Table
            caption="Capabilities whose provider is not selected in the source"
            captionHidden
            headers={["Capability", "Selected under", "Where to check it"]}
            rowKeys={trustUnselectedIntegrations.map(
              (entry) => entry.capability,
            )}
            rows={trustUnselectedIntegrations.map((entry) => [
              entry.capability,
              <StatusBadge key="g" tone="neutral">
                {entry.gate}
              </StatusBadge>,
              <code key="e" className={styles.evidence}>
                {entry.evidencePath}
              </code>,
            ])}
          />
        </Section>

        <Section
          title="What this page does not claim"
          description="Each item names the external gate that has to close before the claim could be made at all."
        >
          <ul className={styles.gapList}>
            {trustGaps.map((gap) => (
              <li key={gap.id} className={styles.gap}>
                <div className={styles.gapHeader}>
                  <StatusBadge tone="warning">Requires {gap.gate}</StatusBadge>
                  <code className={styles.evidence}>{gap.evidencePath}</code>
                </div>
                <p className={styles.gapStatement}>{gap.statement}</p>
              </li>
            ))}
          </ul>
        </Section>

        <p className={styles.footnote}>
          This page is rendered from the source of the deployment you are
          talking to. There is no separate publication step and no copy of it
          kept anywhere else, so it cannot be stale relative to that deployment.
          It can, of course, be behind what we have merged since.
        </p>
      </div>
    </main>
  );
}
