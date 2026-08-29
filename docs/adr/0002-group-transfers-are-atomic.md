# Group transfers are atomic

A group transfer commits for every recipient or for none. One invalid recipient, or insufficient
funds for the total, fails the whole group.

Independent per-recipient transfers were the obvious alternative and are what a naive implementation
produces, but a partially-completed group leaves the sender in a state they did not ask for and have
to reason about. Atomicity also means the group needs no new machinery: the same row locks that
protect a one-to-one transfer protect N recipients.
