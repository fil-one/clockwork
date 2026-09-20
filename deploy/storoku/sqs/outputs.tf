output "id" {
  value = aws_sqs_queue.queue.id
}

output "arn" {
  value = aws_sqs_queue.queue.arn
}

output "dead_letter_id" {
  value = aws_sqs_queue.queue_deadletter.id
}

output "dead_letter_arn" {
  value = aws_sqs_queue.queue_deadletter.arn
}
