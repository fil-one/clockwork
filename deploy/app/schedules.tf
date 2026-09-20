# storoku:ignore
#
# Cron for the background tasks. EventBridge Scheduler puts one message on the
# workflows queue per tick and the in-process poller runs it, which is the same
# path an on-demand task takes.
#
# The schedules come from schedule-manifest.json, generated from the task
# registry by `pnpm generate:schedules` and checked for drift by
# `pnpm check:generated`. A task declares its own cron in TypeScript; nothing
# about a schedule is decided here.

locals {
  schedule_stage    = local.is_production ? "production" : "staging"
  schedule_manifest = jsondecode(file("${path.module}/schedule-manifest.json"))
  # Only the selected runtime gets a cron. Trigger.dev schedules its own tasks,
  # and the web host starts no poller in that mode, so a schedule here would
  # put ticks on a queue nothing reads: they would sit until the retention
  # window, raise the backlog alarm, and all arrive at once on a switch back.
  schedules_enabled = var.task_runtime == "sqs"
  schedules = {
    for schedule in local.schedule_manifest.schedules :
    schedule.taskId => schedule
    if local.schedules_enabled && contains(schedule.stages, local.schedule_stage)
  }
}

resource "aws_scheduler_schedule_group" "tasks" {
  count = local.schedules_enabled ? 1 : 0

  name = "${terraform.workspace}-${var.app}-tasks"
}

data "aws_iam_policy_document" "scheduler_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  count = local.schedules_enabled ? 1 : 0

  name               = "${terraform.workspace}-${var.app}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume_role.json
}

# The scheduler's whole job is to enqueue; it holds no other permission.
resource "aws_iam_role_policy" "scheduler_send_message" {
  count = local.schedules_enabled ? 1 : 0

  name = "${terraform.workspace}-${var.app}-scheduler-send-message"
  role = aws_iam_role.scheduler[0].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = module.app.queue["workflows"].arn
      },
    ]
  })
}

resource "aws_scheduler_schedule" "task" {
  for_each = local.schedules

  # The task id alone: the group already carries the workspace, and a prefixed
  # name puts the longest task ids over the 64-character limit.
  name       = each.key
  group_name = aws_scheduler_schedule_group.tasks[0].name

  # Caught here rather than as an opaque API error halfway through an apply.
  lifecycle {
    precondition {
      condition     = length(each.key) <= 64
      error_message = "Schedule name for task ${each.key} exceeds the 64 characters EventBridge Scheduler allows."
    }
  }

  # A schedule that fires late is a schedule that fires; the tasks are
  # idempotent and a fixed minute keeps the manifest and the console agreeing.
  flexible_time_window {
    mode = "OFF"
  }
  schedule_expression          = each.value.scheduleExpression
  schedule_expression_timezone = "UTC"

  target {
    arn      = module.app.queue["workflows"].arn
    role_arn = aws_iam_role.scheduler[0].arn
    # Same grouping the application submitter uses: one task id, one ordered lane.
    sqs_parameters {
      message_group_id = each.key
    }
    # The tick time the task receives; the poller passes it through as the
    # scheduled payload.
    input = jsonencode({
      taskId      = each.key
      scheduledAt = "<aws.scheduler.scheduled-time>"
    })
  }
}
