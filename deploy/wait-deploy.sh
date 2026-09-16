#!/usr/bin/env bash
# Waits for the CodeDeploy deployment `make apply` just created. The apply's
# code_deploy.sh writes its id to app/.last-deployment-id; when no deployment
# was created this run (nothing about the task changed) the file is absent
# and the in-flight list is consulted instead.
set -euo pipefail

: "${TF_VAR_region:?}" "${TF_WORKSPACE:?}" "${TF_VAR_app:?}"

id=$(cat app/.last-deployment-id 2>/dev/null || true)
if [ -z "$id" ]; then
  id=$(aws deploy list-deployments --region "$TF_VAR_region" \
    --application-name "$TF_WORKSPACE-$TF_VAR_app-code-deploy-app" \
    --deployment-group-name "$TF_WORKSPACE-$TF_VAR_app-code-deploy-deployment-group" \
    --include-only-statuses Created Queued InProgress Ready \
    --query 'deployments[0]' --output text)
fi
if [ -z "$id" ] || [ "$id" = "None" ]; then
  echo "no deployment in progress"
  exit 0
fi

echo "waiting for deployment $id"
aws deploy wait deployment-successful --region "$TF_VAR_region" --deployment-id "$id"
aws deploy get-deployment --region "$TF_VAR_region" --deployment-id "$id" \
  --query 'deploymentInfo.[status, completeTime]' --output text
