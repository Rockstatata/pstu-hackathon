# No offline transfer queueing

The PWA is readable offline — cached balance and history, clearly timestamped "last updated" — but
sending is disabled when offline rather than queued for replay.

A queued transfer is one whose balance check happened in the past, so it promises the user something
we cannot honour: on reconnect it either fails silently after the user believed it sent, or it forces
a pending state through the entire ledger. We refused this on purpose. If a future reader wonders why
the obvious offline-first feature is missing, this is why.
