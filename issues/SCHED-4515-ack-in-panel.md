---
id: SCHED-4515
title: Ack moves from the row into an incident panel
status: done
plan: R2
---

Product's decision after step-one evidence (recording 00:13: on-call aimed at INC-2875's Ack, INC-5305 landed at the
top, the click acked INC-5305): new incidents stay live at the top. Ack leaves the row: a row opens its incident panel,
and Ack lives there.

- Row: no `ack` button. Click (or Enter/Space) opens the panel for that row's incident.
- Panel (`data-testid="incident-panel"`): names the incident id and its details; `panel-ack` acks the incident the panel
  names, by id, whatever the rows do meanwhile.
- The row keeps its `acked` mark after an ack.

Acceptance: with incidents landing while the pointer is on the list, every ack goes to the incident the panel names.
