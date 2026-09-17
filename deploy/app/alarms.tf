# storoku:ignore
#
# A task that fails eight receives lands on the dead-letter queue and stops
# running. Nothing else notices, so the alarm is the notice: any message on the
# dead-letter queue is a task that has given up.

resource "aws_cloudwatch_metric_alarm" "workflows_dead_letter" {
  alarm_name        = "${terraform.workspace}-${var.app}-workflows-dead-letter"
  alarm_description = "A background task exhausted its receives and is on the workflows dead-letter queue."

  namespace   = "AWS/SQS"
  metric_name = "ApproximateNumberOfMessagesVisible"
  # CloudWatch keys SQS metrics by queue name, which is the last element of the arn.
  dimensions = {
    QueueName = element(split(":", module.app.queue["workflows"].dead_letter_arn), 5)
  }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  # An empty queue reports no data rather than zero; that is the healthy state.
  treat_missing_data = "notBreaching"

  alarm_actions = [module.app.topics["workflow-alarms"].arn]
  ok_actions    = [module.app.topics["workflow-alarms"].arn]
}

# The dead-letter alarm reports tasks that ran and failed. It cannot report a
# poller that never started: nothing receives the messages, so nothing is
# redriven and the dead-letter queue stays empty while invoicing, dunning and
# outbox dispatch quietly stop. The age of the oldest message on the main queue
# is what shows that, whatever the cause.
resource "aws_cloudwatch_metric_alarm" "workflows_backlog_age" {
  alarm_name        = "${terraform.workspace}-${var.app}-workflows-backlog-age"
  alarm_description = "Background tasks are not being drained: the oldest message on the workflows queue is over fifteen minutes old."

  namespace   = "AWS/SQS"
  metric_name = "ApproximateAgeOfOldestMessage"
  dimensions = {
    QueueName = element(split(":", module.app.queue["workflows"].arn), 5)
  }
  statistic = "Maximum"
  period    = 300
  # Two periods: the slowest scheduled task and its retries are minutes, not
  # a quarter of an hour, and a single spike is not an outage.
  evaluation_periods  = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 900
  # An empty queue reports no data rather than zero; that is the healthy state.
  treat_missing_data = "notBreaching"

  alarm_actions = [module.app.topics["workflow-alarms"].arn]
  ok_actions    = [module.app.topics["workflow-alarms"].arn]
}
