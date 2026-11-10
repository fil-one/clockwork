#!/usr/bin/env bash
# Operate through the existing environment deployment role; never export keys.
set -euo pipefail

: "${EXPECTED_AWS_ACCOUNT:?Missing expected account}"
: "${SIGNING_EMAIL_DOMAIN:?Missing sender domain}"
account=$(aws sts get-caller-identity --query Account --output text)
[[ "$account" == "$EXPECTED_AWS_ACCOUNT" ]] || { echo 'Wrong AWS account' >&2; exit 1; }

case "${SIGNING_EMAIL_ACTION:-inspect}" in
  inspect) ;;
  verify-test-recipients)
    : "${SIGNING_TEST_RECIPIENTS:?No approved test recipients}"
    IFS=',' read -r -a recipients <<< "$SIGNING_TEST_RECIPIENTS"
    for recipient in "${recipients[@]}"; do
      [[ "$recipient" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || { echo 'Invalid approved address' >&2; exit 1; }
    done
    identities=$(aws sesv2 list-email-identities --output json)
    for recipient in "${recipients[@]}"; do
      if ! jq -e --arg address "$recipient" '.EmailIdentities[] | select(.IdentityName == $address)' <<< "$identities" >/dev/null; then
        aws sesv2 create-email-identity --email-identity "$recipient" --query '{IdentityType:IdentityType,Verified:VerifiedForSendingStatus}'
      fi
    done
    ;;
  request-production-access)
    # This submits a request; only AWS can approve it. It sends no mail.
    if [[ "$(aws sesv2 get-account --query ProductionAccessEnabled --output text)" != True ]]; then
      aws sesv2 put-account-details --production-access-enabled \
        --mail-type TRANSACTIONAL --website-url https://commerce.fil.one \
        --contact-language EN \
        --use-case-description 'Fil One Commerce sends transactional agreement invitations, explicitly requested reminders, and completed-document links to recipients selected by authorized staff for their business agreements. No purchased lists or marketing campaigns. Signing mail is held disabled in production until sender verification and the staged delivery pilot pass.'
    fi
    ;;
  *) echo 'Unknown signing email action' >&2; exit 1 ;;
esac

aws sesv2 get-account --query '{SendingEnabled:SendingEnabled,ProductionAccessEnabled:ProductionAccessEnabled,SendQuota:SendQuota,SuppressionAttributes:SuppressionAttributes,Review:Details.ReviewDetails}'
aws sesv2 list-email-identities --query 'EmailIdentities[].{Identity:IdentityName,Verified:SendingEnabled,Status:VerificationStatus}'
aws sesv2 get-email-identity --email-identity "$SIGNING_EMAIL_DOMAIN" --query '{Identity:IdentityType,Verified:VerifiedForSendingStatus,Verification:VerificationStatus,DkimStatus:DkimAttributes.Status}'
