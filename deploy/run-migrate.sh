#!/usr/bin/env bash
# Runs the migration task definition registered by `make migrate` to
# completion and fails if it did. Needs TF_VAR_region, TF_WORKSPACE and
# TF_VAR_app in the environment (the Makefile exports them) and an
# initialised app root to read outputs from.
set -euo pipefail

: "${TF_VAR_region:?}" "${TF_WORKSPACE:?}" "${TF_VAR_app:?}"

cluster="$TF_WORKSPACE-$TF_VAR_app-cluster"
family=$(tofu -chdir=app output -raw migrate_task_definition)
network=$(tofu -chdir=app output -raw migrate_network_configuration)
log_group=$(tofu -chdir=app output -raw log_group)

# A placement failure (capacity, image pull, role) comes back as an empty
# task list and a populated failures list, with exit code 0.
read -r task_arn failure < <(aws ecs run-task \
  --region "$TF_VAR_region" \
  --cluster "$cluster" \
  --task-definition "$family" \
  --launch-type FARGATE \
  --count 1 \
  --network-configuration "$network" \
  --query '[tasks[0].taskArn, failures[0].reason]' --output text)
if [ -z "$task_arn" ] || [ "$task_arn" = "None" ]; then
  echo "migration task was not placed: ${failure:-no reason given}" >&2
  exit 1
fi
task_id=${task_arn##*/}
echo "migration task $task_id started"

# aws ecs wait tasks-stopped gives up after ten minutes; the first migration
# of a fresh database takes a while, so poll for up to thirty.
status=""
for _ in $(seq 1 120); do
  status=$(aws ecs describe-tasks --region "$TF_VAR_region" --cluster "$cluster" --tasks "$task_arn" \
    --query 'tasks[0].lastStatus' --output text)
  [ "$status" = "STOPPED" ] && break
  sleep 15
done

echo "--- migration log"
aws logs tail "$log_group" --region "$TF_VAR_region" \
  --log-stream-names "migrate/migrate/$task_id" --since 1h --format short || true
echo "---"

if [ "$status" != "STOPPED" ]; then
  echo "migration task $task_id is still $status after thirty minutes" >&2
  exit 1
fi

read -r exit_code stop_reason < <(aws ecs describe-tasks --region "$TF_VAR_region" --cluster "$cluster" --tasks "$task_arn" \
  --query 'tasks[0].[containers[0].exitCode, stoppedReason]' --output text)
if [ "$exit_code" != "0" ]; then
  echo "migration task $task_id failed: exit code $exit_code ($stop_reason)" >&2
  exit 1
fi
echo "migration task $task_id succeeded"
