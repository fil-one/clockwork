import { defineStaffMessages } from "../define";

/**
 * Customer and partner organizations operations sets up, at
 * /internal/organizations. Part of the operations module.
 */
export const organizationMessages = defineStaffMessages({
  "operations.organizations.title": { en: "Organizations" },
  "operations.organizations.description": {
    en: "Customer and partner organizations in Commerce, newest first.",
  },
  "operations.organizations.new": { en: "Set up an organization" },
  "operations.organizations.empty.title": { en: "No organizations yet" },
  "operations.organizations.empty.description": {
    en: "Set one up from a handoff, or with Set up an organization.",
  },
  "operations.organizations.unavailable": {
    en: "Organizations could not be loaded right now. Reload the page in a minute.",
  },
  "operations.organizations.side.customer": { en: "Customer" },
  "operations.organizations.side.channel_partner": { en: "Channel partner" },
  "operations.organizations.side.referral_partner": { en: "Referral partner" },
  "operations.organizations.side.fil_one": { en: "Fil One" },
  "operations.organizations.column.name": { en: "Legal name" },
  "operations.organizations.column.side": { en: "Side" },
  "operations.organizations.column.country": { en: "Country" },
  "operations.organizations.column.created": { en: "Created" },
  "operations.organizations.column.signIn": { en: "Sign-in" },
  "operations.organizations.signIn.ready": { en: "Ready" },
  "operations.organizations.signIn.pending": {
    en: "Being set up with the sign-in service",
  },

  "operations.organizations.form.title": { en: "Set up an organization" },
  "operations.organizations.form.description": {
    en: "Creates the account and organization. Its account stays in screening review until screening clears it, and nobody can sign in until you invite them.",
  },
  "operations.organizations.form.fromHandoff": {
    en: "From the handoff for {name}. The organization is recorded on it.",
  },
  "operations.organizations.form.legalName": { en: "Legal name" },
  "operations.organizations.form.side": { en: "Side" },
  "operations.organizations.form.agreementType": {
    en: "How the partner sells",
  },
  "operations.organizations.form.agreementType.resale": { en: "Resale" },
  "operations.organizations.form.agreementType.msp": {
    en: "Managed service provider",
  },
  "operations.organizations.form.agreementType.embedded": { en: "Embedded" },
  "operations.organizations.form.country": { en: "Country" },
  "operations.organizations.form.countryHelp": {
    en: "Two-letter code, for example US or GB.",
  },
  "operations.organizations.form.currency": { en: "Billing currency" },
  "operations.organizations.form.domain": { en: "Business domain" },
  "operations.organizations.form.domainHelp": {
    en: "For example example.com. One organization per domain.",
  },
  "operations.organizations.form.line1": { en: "Street address" },
  "operations.organizations.form.line2": { en: "Address line 2" },
  "operations.organizations.form.city": { en: "City" },
  "operations.organizations.form.region": { en: "State or region" },
  "operations.organizations.form.postalCode": { en: "Postal code" },
  "operations.organizations.form.billingName": { en: "Billing contact name" },
  "operations.organizations.form.billingEmail": {
    en: "Billing contact email",
  },
  "operations.organizations.form.invoiceEmail": {
    en: "Invoice delivery email",
  },
  "operations.organizations.form.optional": { en: "Optional" },
  "operations.organizations.form.submit": { en: "Create organization" },
  "operations.organizations.form.pending": { en: "Creating…" },
  "operations.organizations.form.handoffClosed": {
    en: "This handoff is not in progress, so no organization can be set up from it. Take it first.",
  },

  "operations.organizations.detail.back": { en: "All organizations" },
  "operations.organizations.detail.account": { en: "Account" },
  "operations.organizations.detail.domain": { en: "Business domain" },
  "operations.organizations.detail.currency": { en: "Currency" },
  "operations.organizations.detail.billing": { en: "Billing contact" },
  "operations.organizations.detail.screening": { en: "Screening" },
  "operations.organizations.detail.agreementType": { en: "Partner agreement" },
  "operations.organizations.detail.signIn": { en: "Sign-in" },
  "operations.organizations.detail.handoffs": { en: "From handoff" },
  "operations.organizations.detail.members": { en: "People" },
  "operations.organizations.detail.noMembers": {
    en: "Nobody yet. Invite the first administrator below.",
  },
  "operations.organizations.detail.created": {
    en: "Organization created.",
  },

  "operations.organizations.handoff.setUp": { en: "Set up the organization" },
  "operations.organizations.handoff.open": { en: "Open the organization" },
  "operations.organizations.handoff.next": {
    en: "Next: set up the organization, invite the signer as its first administrator, then mark this handoff done.",
  },

  "operations.organizations.invites.title": { en: "Invitations" },
  "operations.organizations.invites.description": {
    en: "No email is sent. Copy the link and send it to the person yourself. They sign in with the invited email and accept; the link works once and expires after 14 days.",
  },
  "operations.organizations.invites.email": { en: "Email" },
  "operations.organizations.invites.role": { en: "Role" },
  "operations.organizations.invites.submit": { en: "Create invitation" },
  "operations.organizations.invites.pending": { en: "Creating…" },
  "operations.organizations.invites.done": {
    en: "Invitation created for {email}. Copy the link below and send it to them.",
  },
  "operations.organizations.invites.empty": {
    en: "No invitations yet.",
  },
  "operations.organizations.invites.unavailable": {
    en: "Invitations cannot be read on this deployment right now.",
  },
  "operations.organizations.invites.link": { en: "Invitation link" },
  "operations.organizations.invites.state.pending": {
    en: "Waiting, expires {date}",
  },
  "operations.organizations.invites.state.accepted": { en: "Accepted {date}" },
  "operations.organizations.invites.state.expired": { en: "Expired {date}" },
  "operations.organizations.invites.state.void": {
    en: "Link no longer works. Revoke it and invite again.",
  },
  "operations.organizations.invites.revoke": { en: "Revoke" },
  "operations.organizations.invites.revoked": {
    en: "Invitation for {email} revoked. Its link no longer works.",
  },
  "operations.organizations.error.INVITE_NOT_FOUND": {
    en: "This invitation no longer exists.",
  },
  "operations.organizations.error.INVITE_NOT_PENDING": {
    en: "This invitation was already accepted or has expired.",
  },
  "operations.organizations.error.INVITE_ORGANIZATION_NOT_FOUND": {
    en: "This organization does not exist.",
  },
  "operations.organizations.error.INVITE_ROLE_NOT_ALLOWED_ON_SIDE": {
    en: "That role is not available in this organization.",
  },
  "operations.organizations.error.INVITE_ALREADY_PENDING": {
    en: "This person already has an invitation waiting. Copy its link below.",
  },
  "operations.organizations.error.INVITE_ALREADY_MEMBER": {
    en: "This person is already a member of this organization.",
  },
  "operations.organizations.error.INVITE_UNAVAILABLE": {
    en: "Invitations cannot be created on this deployment right now.",
  },
  "operations.organizations.error.ONBOARDING_HANDOFF_NOT_IN_PROGRESS": {
    en: "Take the handoff before setting up its organization.",
  },
  "operations.organizations.error.ONBOARDING_HANDOFF_SIDE_MISMATCH": {
    en: "The handoff asks for a different side. Choose the side sales asked for, or decline the handoff.",
  },
  "operations.organizations.error.ONBOARDING_HANDOFF_ALREADY_HAS_ORGANIZATION":
    { en: "This handoff already has an organization." },
  "operations.organizations.error.ONBOARDING_ORGANIZATION_EXISTS": {
    en: "This organization was already created. Reload the page.",
  },
  "operations.organizations.error.ONBOARDING_ACCOUNT_EXISTS": {
    en: "An account with this legal name already exists in this country.",
  },
  "operations.organizations.error.ONBOARDING_DOMAIN_TAKEN": {
    en: "Another account already uses this business domain.",
  },
  "operations.organizations.error.ONBOARDING_ORGANIZATION_NOT_FOUND": {
    en: "This organization does not exist.",
  },
  "operations.organizations.error.HANDOFF_NOT_FOUND": {
    en: "The handoff no longer exists.",
  },
  "operations.organizations.error.INVALID_INPUT": {
    en: "Check the highlighted fields.",
  },
  "operations.organizations.error.CONTRACT_FORBIDDEN": {
    en: "Your role cannot do this.",
  },
  "operations.organizations.error.CONTRACT_MFA_REQUIRED": {
    en: "Verify your sign-in with your authenticator, then try again.",
  },
  "operations.organizations.error.CONTRACT_DEMO_UNAVAILABLE": {
    en: "Setting up organizations is turned off in the demo.",
  },
  "operations.organizations.error.SESSION_EXPIRED": {
    en: "Your session expired. Reload to continue.",
  },
  "operations.organizations.error.UNEXPECTED": {
    en: "That did not work. Try again in a minute. If it keeps failing, tell engineering.",
  },
});
