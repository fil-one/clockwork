# ADR 0010: Vendor-neutral task runtime

Status: Accepted, 2026-09-17, by the Head of Engineering standing in for the
workflow owner. Supersedes the hosting decision in
[ADR 0006](0006-trigger-workflows.md); the durability rules there stand.

A task is defined once, against `packages/workflows/src/tasks/definition.ts`: an
id, a payload parser, a retry policy and a run function. Nothing in a task
module names a runtime. `CLOCKWORK_TASK_RUNTIME` selects one at the composition
root, `trigger` or `sqs`, and the same task code runs under either.

The Trigger adapter registers each definition as a Trigger.dev task and submits
through the Trigger SDK, which is what ADR 0006 described. The SQS adapter
submits to a FIFO queue in the deployment's own AWS account and runs tasks in a
poller inside the web container; EventBridge Scheduler supplies the crons from a
manifest generated from the task registry. `deploy/README.md` describes that
arrangement.

The durability model does not change. Task ids stay lane-prefixed and
permanently versioned. The invocation idempotency key is still derived from
aggregate type, id, version and operation, and still ignores payload and retry
count. `workflow_runs` still mirrors run ids and outcomes; under SQS the run id
is the message id. Transient failures still retry with bounded exponential
backoff and permanent failures still enter the owned exception queue. Tasks
still claim outbox rows and can be replayed safely. Local tests still call pure
handlers through the deterministic runner and still need no credentials.

Two things the SQS runtime does not have. Durable human waits are Trigger
primitives with no queue equivalent, so a deployment that needs one runs on
`trigger`. FIFO ordering is per message group, and the group is the task id,
which caps a single task's parallelism at one; the submission carries an
optional group key for a task that later needs to fan out.

The reason for the choice is that Trigger.dev Cloud reaches the database on
`DIRECT_DATABASE_URL`, and the deployment's database answers only inside its
VPC. The alternatives were to expose the database to the internet behind a
restricted security group, or to self-host Trigger. Running tasks where the
application already runs avoids both, and keeps every credential the tasks use
inside one account. Trigger stays selectable rather than removed, because the
waits are real and the adapter is small.
