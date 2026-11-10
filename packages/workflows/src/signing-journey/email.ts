import type {
  SigningMailPurpose,
  SigningRecipient,
} from "@clockwork/contracts";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );

/** The agreements are English; recipient correspondence uses the same
 * language. Templates are shared by invitations, reminders and final copies. */
export function signingEmail(
  recipient: SigningRecipient,
  purpose: SigningMailPurpose,
  href: string,
  origin: string,
) {
  const complete = purpose === "completed";
  const heading = complete
    ? "Your signed agreement is ready"
    : purpose === "reminder"
      ? "A reminder to sign your agreement"
      : "An agreement for your review";
  const detail = complete
    ? "All required signatures are complete. You can download and keep a copy of the signed agreement."
    : recipient.slot === "fil-one"
      ? "The agreement is ready for your Fil One signature. Please review the document and any details completed by the counterparty."
      : "Please review your agreement with Fil One, complete any missing details, and add your signature. We will send you a copy when all required signatures are complete.";
  const action = complete ? "View signed agreement" : "Review and sign";
  const test = recipient.testMode
    ? "TEST DOCUMENT — for testing only.\n\n"
    : "";
  return {
    subject: `${recipient.testMode ? "[Test] " : ""}${complete ? "Signed" : purpose === "reminder" ? "Reminder" : "Please review"}: ${recipient.title}`,
    text: `${test}${heading}\n\nHello ${recipient.name},\n\n${detail}\n\n${recipient.title}\n\n${action}: ${href}\n\nThis private link is for you and expires in seven days. If you need help or the details are incorrect, contact the person who sent you the agreement.\n\nFil One`,
    html: `<!doctype html><html lang="en"><body style="margin:0;background:#f4f7fa;color:#14283e;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:40px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:auto"><tr><td style="padding-bottom:28px"><img src="${escape(origin)}/brand/fo-wordmark-dark.png" alt="Fil One" width="116" style="display:block;width:116px;height:auto"></td></tr><tr><td style="background:#fff;padding:36px;border:1px solid #e0e8ef;border-radius:12px">${recipient.testMode ? '<p style="color:#855c0b;font-size:12px">TEST DOCUMENT · FOR TESTING ONLY</p>' : ""}<p style="font-size:12px;color:#63778a;letter-spacing:1px">AGREEMENTS</p><h1 style="font-size:26px;line-height:1.2;font-weight:500;margin:16px 0 24px">${heading}</h1><p style="line-height:1.6">Hello ${escape(recipient.name)},</p><p style="line-height:1.6;color:#526578">${detail}</p><p style="padding:18px 0;border-top:1px solid #e0e8ef;border-bottom:1px solid #e0e8ef;font-weight:600">${escape(recipient.title)}</p><p style="margin:30px 0"><a href="${escape(href)}" style="display:inline-block;background:#006bc7;color:#fff;text-decoration:none;padding:14px 22px;border-radius:7px;font-weight:600">${action}</a></p><p style="font-size:12px;line-height:1.6;color:#63778a">This private link is for you and expires in seven days. If you need help or the details are incorrect, contact the person who sent you the agreement.</p></td></tr><tr><td style="padding-top:24px;font-size:12px;color:#63778a">Fil One · Secure document signing</td></tr></table></td></tr></table></body></html>`,
  };
}
