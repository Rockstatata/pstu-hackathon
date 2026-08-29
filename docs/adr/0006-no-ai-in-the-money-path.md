# No AI in the money path

Risk scoring for step-up authentication is a deterministic rule table — amount thresholds, first-time
recipient, transfer velocity — not a model. No AI service participates in deciding whether money
moves.

This is recorded because the project scaffolding names an `ai_service/` environment, so a future
reader will reasonably wonder why it is unused here. The reason is explainability: the brief requires
us to defend our engineering decisions, and "why did it block that transfer?" must have an answer we
can point at in a table. If an assistant feature is added later, it may only produce a draft
intention that the user confirms through the normal validated transfer path.
