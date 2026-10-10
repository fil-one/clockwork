import { defineStaffMessages, sameInAllLanguages } from "../define";

/**
 * Staff team management at /internal/team and the owner console at
 * /internal/owner. Part of the operations module.
 */
export const teamMessages = defineStaffMessages({
  "operations.team.title": { en: "Team" },
  "operations.team.description": {
    en: "Fil One staff who can sign in to Fil One Commerce, and what each of them can do.",
  },
  "operations.team.demoNotice": {
    en: "This demo shows sample people. Adding, changing and removing access is turned off.",
  },
  "operations.team.unavailable": {
    en: "The team list could not be loaded right now. Reload the page in a minute. If it keeps failing, tell engineering.",
  },
  "operations.team.roles.title": { en: "What each role can do" },
  "operations.team.roles.revenue": {
    en: "Sales work: the home page, MNDAs, contracts, the sales library and pricing.",
  },
  "operations.team.roles.commerceAdmin": {
    en: "Everything every other staff role can do, plus signing settings, this team page and the owner console.",
  },
  "operations.team.roles.internalOperator": {
    en: "Operations tools for the platform team. No team or signing settings.",
  },
  "operations.team.invite.title": { en: "Add a team member" },
  "operations.team.invite.description": {
    en: "No email is sent. Tell the person to sign in to Fil One Commerce with this work email. On their first sign-in they confirm the email and set up an authenticator app.",
  },
  "operations.team.invite.name": { en: "Full name" },
  "operations.team.invite.email": { en: "Work email" },
  "operations.team.invite.emailHelp": { en: "Use an address on {domains}." },
  "operations.team.invite.jobTitle": { en: "Job title" },
  "operations.team.invite.optional": { en: "Optional" },
  "operations.team.invite.role": { en: "Role" },
  "operations.team.invite.submit": { en: "Add to team" },
  "operations.team.invite.pending": { en: "Adding…" },
  "operations.team.invite.done": {
    en: "{name} can now sign in with {email}. Let them know, since no email was sent.",
  },
  "operations.team.list.title": { en: "People with access" },
  "operations.team.list.empty.title": { en: "No one is on the team yet" },
  "operations.team.list.empty.description": {
    en: "Add the first team member with the form on this page.",
  },
  "operations.team.column.name": { en: "Name" },
  "operations.team.column.email": { en: "Email" },
  "operations.team.column.role": { en: "Roles" },
  "operations.team.column.mfa": { en: "Authenticator" },
  "operations.team.column.added": { en: "Added" },
  "operations.team.column.actions": { en: "Access" },
  "operations.team.you": { en: "You" },
  "operations.team.mfa.verified": { en: "Checked {date}" },
  "operations.team.mfa.enrolled": { en: "Set up" },
  "operations.team.mfa.unknown": { en: "Not confirmed yet" },
  "operations.team.role.change": { en: "Change roles" },
  "operations.team.role.granted": { en: "{name} now has the {role} role." },
  "operations.team.role.revoked": {
    en: "{name} no longer has the {role} role.",
  },
  "operations.team.role.managedElsewhere": {
    en: "Managed by deployment provisioning",
  },
  "operations.team.self": {
    en: "Another commerce administrator can change your access.",
  },
  "operations.team.deactivate": { en: "Remove access" },
  "operations.team.deactivate.confirm": {
    en: "Remove access for {name}? They will no longer be able to sign in to Fil One Commerce. Their past activity stays on record.",
  },
  "operations.team.deactivate.keep": { en: "Keep access" },
  "operations.team.deactivate.done": { en: "{name} no longer has access." },
  "operations.team.working": { en: "Saving…" },
  "operations.team.verify": { en: "Verify sign-in" },
  "operations.team.error.notPermitted": {
    en: "Only a commerce administrator can change the team.",
  },
  "operations.team.error.directSession": {
    en: "Team changes need your own signed-in session. End any assisted session, then try again.",
  },
  "operations.team.error.recentSignIn": {
    en: "For security, team changes need a recent sign-in check. Verify your sign-in, then try again.",
  },
  "operations.team.error.invalid": {
    en: "Check the name, email and role, then try again.",
  },
  "operations.team.error.domain": {
    en: "Use a Fil One work email address on {domains}.",
  },
  "operations.team.error.notConfigured": {
    en: "Team changes are not set up in this environment. Use deployment provisioning instead.",
  },
  "operations.team.error.adminRequired": {
    en: "Your commerce administrator role could not be confirmed. Sign out and back in, or ask another administrator.",
  },
  "operations.team.error.notFound": {
    en: "That person is no longer on the team. The list is up to date now.",
  },
  "operations.team.error.self": {
    en: "You cannot change your own access. Ask another commerce administrator.",
  },
  "operations.team.error.lastAdmin": {
    en: "Fil One needs at least one commerce administrator. Make someone else an administrator first.",
  },
  "operations.team.error.alreadyMember": {
    en: "This person is already on the team. Change their role in the list instead.",
  },
  "operations.team.error.identityConflict": {
    en: "This email belongs to a customer or partner account, so it cannot be added as staff. Use another work email or ask engineering.",
  },
  "operations.team.error.roleNotManaged": {
    en: "This person's role is managed through deployment provisioning, not on this page.",
  },
  "operations.team.error.roleUnchanged": {
    en: "This person already has that role.",
  },
  "operations.team.error.roleNotHeld": {
    en: "This person no longer has that role. The list now shows their current roles.",
  },
  "operations.team.error.lastRole": {
    en: "Everyone on the team keeps at least one role. To end this person's access, use Remove access instead.",
  },
  "operations.team.error.stale": {
    en: "Someone changed this person's access a moment ago. The list is up to date now, so check it and try again.",
  },
  "operations.team.error.workosNotLinked": {
    en: "This team is not linked to the sign-in service yet. Use deployment provisioning instead.",
  },
  "operations.team.error.provider": {
    en: "The sign-in service did not respond, so the change was not made. Try again in a minute.",
  },
  "operations.team.error.unexpected": {
    en: "Something went wrong and nothing was changed. Try again, and tell engineering if it keeps happening.",
  },
  // Several roles per person, the roles dialog and effective permissions.
  "operations.team.roles.combine": {
    en: "A person can hold several roles and may do anything any of their roles allows. Their first role decides which home page they see.",
  },
  "operations.team.roles.financeApprover": {
    en: "Approves pricing, credits, refunds and other money decisions. Sees only the finance records it decides.",
  },
  "operations.team.roles.legalApprover": {
    en: "Approves agreements and contracts.",
  },
  "operations.team.roles.destructiveActionApprover": {
    en: "Approves account closures, data deletion and other changes that cannot be undone.",
  },
  "operations.team.invite.roleHelp": {
    en: "Start with one role. You can add more once they are on the team.",
  },
  "operations.team.role.dialog.title": { en: "Roles for {name}" },
  "operations.team.role.dialog.description": {
    en: "Add or remove one role at a time. Every change is recorded, and the other commerce administrators are told about it.",
  },
  "operations.team.role.held": { en: "Has this role" },
  "operations.team.role.primary": { en: "Decides their home page" },
  "operations.team.role.add": { en: "Add role" },
  "operations.team.role.remove": { en: "Remove role" },
  "operations.team.role.onlyRole": {
    en: "This is their only role. To end their access completely, use Remove access in the team list.",
  },
  "operations.team.role.reason": { en: "Note for the record" },
  "operations.team.role.reasonHelp": {
    en: "Saved with the next role you add or remove. Up to 500 characters.",
  },
  "operations.team.permissions.show": { en: "What they can do" },
  "operations.team.permissions.title": {
    en: "Everything {name} can do, from all of their roles:",
  },
  "operations.team.permission.accountRead": { en: "See account details" },
  "operations.team.permission.accountWrite": {
    en: "Change account details, users and invitations",
  },
  "operations.team.permission.agreementRead": { en: "Read agreements" },
  "operations.team.permission.agreementExecute": {
    en: "Sign agreements for an account",
  },
  "operations.team.permission.agreementApprove": {
    en: "Approve agreements and legal terms",
  },
  "operations.team.permission.quoteRead": { en: "Read quotes" },
  "operations.team.permission.quoteWrite": { en: "Prepare and change quotes" },
  "operations.team.permission.quoteApprove": {
    en: "Approve pricing, price books and quote exceptions",
  },
  "operations.team.permission.orderRead": { en: "Read orders" },
  "operations.team.permission.orderWrite": {
    en: "Place, change and renew orders",
  },
  "operations.team.permission.billingRead": { en: "Read invoices and billing" },
  "operations.team.permission.billingWrite": {
    en: "Change billing details and pay",
  },
  "operations.team.permission.billingApprove": {
    en: "Approve credits, refunds, commissions and other money decisions",
  },
  "operations.team.permission.partnerPortfolioRead": {
    en: "Read partner portfolios",
  },
  "operations.team.permission.partnerQuoteWrite": {
    en: "Prepare partner quotes for resale",
  },
  "operations.team.permission.pocManage": { en: "Run proofs of concept" },
  "operations.team.permission.reportRead": { en: "Read and export reports" },
  "operations.team.permission.systemOperate": { en: "Use the platform tools" },
  "operations.team.permission.impersonationAssume": {
    en: "Help inside a customer or partner account through an assisted session",
  },
  "operations.team.permission.destructiveRequest": {
    en: "Ask for an account to be closed or deleted",
  },
  "operations.team.permission.destructiveApprove": {
    en: "Approve account closures and data deletion",
  },
  "operations.team.permission.migrationExecute": {
    en: "Move accounts over from earlier systems",
  },
  "operations.team.permission.mndaSend": { en: "Send MNDAs" },
  "operations.team.permission.contractRead": { en: "Read contracts" },
  "operations.team.permission.contractWrite": { en: "Prepare contracts" },
  "operations.team.permission.contractApprove": { en: "Approve contracts" },
  "operations.team.permission.signatoryManage": {
    en: "Choose who signs for Fil One and where notices go",
  },
  "operations.team.permission.salesRead": {
    en: "Use the sales workspace and references",
  },
  "operations.team.permission.collateralManage": {
    en: "Manage sales materials",
  },
  "operations.team.permission.operationsRead": {
    en: "Use the operations workspace",
  },
  "operations.team.permission.operationsWrite": {
    en: "Work the operations queues and records",
  },
  "operations.team.permission.staffManage": {
    en: "Add staff, change their roles and remove their access",
  },
  "operations.team.permission.auditRead": {
    en: "Read the full activity history of the accounts they can reach",
  },
  "operations.team.permission.auditAppend": {
    en: "Add to the activity history as their work requires",
  },
  "operations.team.permission.dealRegister": {
    en: "Register deals with Fil One",
  },
  "operations.team.permission.approvalSelf": {
    en: "Approve their own requests, with a recorded reason",
  },
  // The owner console at /internal/owner.
  "operations.owner.title": { en: "Owner console" },
  "operations.owner.description": {
    en: "What needs you, who can do what, and the latest changes to access, in one place.",
  },
  "operations.owner.demoNotice": {
    en: "This demo shows sample records. Marking notices read is turned off.",
  },
  "operations.owner.section.unavailable": {
    en: "This section could not be loaded right now. Reload the page in a minute. If it keeps failing, tell engineering.",
  },
  "operations.owner.notices.title": { en: "Notices for you" },
  "operations.owner.notices.description": {
    en: "Changes to staff access made by other administrators.",
  },
  "operations.owner.notices.empty": {
    en: "Nothing new. A notice appears here when another administrator changes someone's access.",
  },
  "operations.owner.notices.markRead": { en: "Mark as read" },
  "operations.owner.notices.markAll": { en: "Mark all as read" },
  "operations.owner.notices.oneRead": { en: "Notice marked as read." },
  "operations.owner.notices.allRead": { en: "All notices marked as read." },
  "operations.owner.notices.error.notPermitted": {
    en: "Only a commerce administrator can mark these notices read.",
  },
  "operations.owner.notices.error.directSession": {
    en: "Sign in as yourself, with your second sign-in step checked, to mark notices read. An assisted session cannot.",
  },
  "operations.owner.notices.error.invalid": {
    en: "That notice could not be found. Reload the page and try again.",
  },
  "operations.owner.notices.error.notConfigured": {
    en: "Notices cannot be changed in this demo.",
  },
  "operations.owner.notices.error.unexpected": {
    en: "Something went wrong and nothing was changed. Try again, and tell engineering if it keeps happening.",
  },
  "operations.owner.approvals.title": { en: "Waiting for approval" },
  "operations.owner.approvals.description": {
    en: "Requests from every control that wait for a second person. Each one is decided on its own page.",
  },
  "operations.owner.approvals.empty": {
    en: "Nothing is waiting for approval.",
  },
  "operations.owner.approvals.requested": { en: "Requested by {name}" },
  "operations.owner.approvals.open": { en: "Open request" },
  "operations.owner.approvals.yours": {
    en: "Your request: needs a second approver",
  },
  "operations.owner.capabilities.title": { en: "Capability switches" },
  "operations.owner.capabilities.description": {
    en: "Which parts of the business are switched on. Changes happen on the Capabilities page.",
  },
  "operations.owner.capabilities.open": { en: "Open capabilities" },
  "operations.owner.capabilities.empty": { en: "No switches are set up yet." },
  "operations.owner.capabilities.newOn": { en: "New work on" },
  "operations.owner.capabilities.newOff": { en: "New work off" },
  "operations.owner.capabilities.recoveryOn": { en: "Finishing work on" },
  "operations.owner.capabilities.recoveryOff": { en: "Finishing work off" },
  "operations.owner.capabilities.pending": { en: "Switch-on request waiting" },
  "operations.owner.staff.title": { en: "Staff and roles" },
  "operations.owner.staff.description": {
    en: "Everyone who can sign in, with every role they hold.",
  },
  "operations.owner.staff.open": { en: "Manage the team" },
  "operations.owner.staff.empty": { en: "No one is on the team yet." },
  "operations.owner.assisted.title": { en: "Open assisted sessions" },
  "operations.owner.assisted.description": {
    en: "Staff working inside a customer or partner account right now.",
  },
  "operations.owner.assisted.open": { en: "Assisted sessions" },
  "operations.owner.assisted.empty": {
    en: "No one is in an assisted session.",
  },
  "operations.owner.assisted.line": { en: "{name} in {account}" },
  "operations.owner.assisted.expires": { en: "Ends" },
  "operations.owner.security.title": { en: "Recent security events" },
  "operations.owner.security.description": {
    en: "The last 50 changes to staff access, sign-in setup, signing settings, exports and assisted sessions.",
  },
  "operations.owner.security.empty": { en: "No security events yet." },
  "operations.owner.event.staffInvited": {
    en: "{actor} added {subject} to the team as {role}",
  },
  "operations.owner.event.staffReactivated": {
    en: "{actor} restored access for {subject}",
  },
  "operations.owner.event.staffDeactivated": {
    en: "{actor} removed access for {subject}",
  },
  "operations.owner.event.staffRoleChanged": {
    en: "{actor} changed the role of {subject} to {role}",
  },
  "operations.owner.event.staffRoleGranted": {
    en: "{actor} gave {subject} the {role} role",
  },
  "operations.owner.event.staffRoleRevoked": {
    en: "{actor} removed the {role} role from {subject}",
  },
  "operations.owner.event.mfaEnrolled": {
    en: "{actor} set up their authenticator",
  },
  "operations.owner.event.mndaSigner": {
    en: "{actor} updated the MNDA signer {subject}",
  },
  "operations.owner.event.mndaNoticeEmail": {
    en: "{actor} changed the MNDA notice email to {subject}",
  },
  "operations.owner.event.mndaExported": {
    en: "{actor} exported the MNDA register",
  },
  "operations.owner.event.contractsExported": {
    en: "{actor} exported the contract register",
  },
  "operations.owner.event.reportExported": {
    en: "{actor} finished a report export",
  },
  "operations.owner.event.assistedStarted": {
    en: "{actor} started an assisted session in {subject}",
  },
  "operations.owner.event.other": { en: "{actor} changed access or settings" },
  "operations.owner.event.systemActor": sameInAllLanguages(
    "Fil One Commerce",
    "product name",
  ),
  "operations.owner.event.unknownSubject": { en: "a record" },
  "operations.owner.event.reason": { en: "Reason: {reason}" },
  "operations.owner.matrix.title": { en: "Who can do what" },
  "operations.owner.matrix.description": {
    en: "Every role and what it allows, from the same rules the server checks. Change a person's roles on the Team page.",
  },
  "operations.owner.matrix.caption": {
    en: "What each role allows, grouped by who may hold the role",
  },
  "operations.owner.matrix.permission": { en: "What it allows" },
  "operations.owner.matrix.side.filOne": { en: "Fil One staff" },
  "operations.owner.matrix.side.customer": { en: "Customers" },
  "operations.owner.matrix.side.partner": { en: "Partners" },
  "operations.owner.matrix.yes": { en: "Allowed" },
  "operations.owner.matrix.no": { en: "Not allowed" },
  "operations.owner.matrix.referral": {
    en: "Referral partners hold the same roles as channel partners but never prepare partner quotes for resale.",
  },
  "operations.owner.matrix.assisted": {
    en: "Inside an assisted session, staff never get these, whatever their roles: {permissions}.",
  },
  "operations.owner.capability.newBusiness": { en: "New business" },
  "operations.owner.capability.legal": { en: "Legal" },
  "operations.owner.capability.billing": { en: "Billing" },
  "operations.owner.capability.partner": { en: "Partners" },
  "operations.owner.capability.marketplace": { en: "Marketplace" },
  "operations.owner.capability.teardown": { en: "Teardown" },
  "operations.owner.approvals.control.priceBook": {
    en: "Price book activation",
  },
  "operations.owner.approvals.control.taxRuleBook": { en: "Tax rule book" },
  "operations.owner.approvals.control.capability": { en: "Capability switch" },
  "operations.owner.approvals.control.channelPolicy": { en: "Channel policy" },
  "operations.owner.approvals.control.paygOffer": { en: "Pay-as-you-go offer" },
  "operations.owner.approvals.control.exception": { en: "Exception" },
  "operations.owner.approvals.control.termination": { en: "Account closure" },
  "operations.owner.approvals.control.contract": { en: "Template contract" },
  "operations.owner.approvals.subject.versioned": {
    en: "{name}, version {version}",
  },
  "operations.owner.approvals.subject.version": { en: "Version {version}" },
  "operations.owner.approvals.subject.policy": {
    en: "Version {version}, effective {date}",
  },
  "operations.owner.approvals.subject.offer": {
    en: "{name} in {region}, version {version}",
  },
  "operations.owner.approvals.subject.exception": { en: "{queue}: {name}" },
  "operations.owner.approvals.requestedBySystem": {
    en: "Raised by Fil One Commerce",
  },
  "operations.owner.approvals.noPage": { en: "Decided outside the portal" },
  "operations.owner.approvals.unavailable": {
    en: "Requests of type {control} could not be loaded right now. Reload the page in a minute; the rest of this list is complete.",
  },
  "operations.owner.approvals.yoursSelf": {
    en: "Your request: you can approve it yourself",
  },
  "operations.owner.event.selfApproved": {
    en: "{actor} approved their own request: {subject}",
  },
  "operations.owner.selfApprovals.title": { en: "Recent self-approvals" },
  "operations.owner.selfApprovals.description": {
    en: "Requests that commerce administrators approved themselves, newest first, with the reason each one gave.",
  },
  "operations.owner.selfApprovals.empty": {
    en: "No one has approved their own request yet.",
  },
  "operations.owner.selfApprovals.line": {
    en: "{actor} approved their own request: {subject}",
  },
});
