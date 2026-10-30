# elata-bio-sdk fork: working instructions

## No decision before a replay on our own real recordings

Every keep, reject, ship or tune decision on a rule, a bar or a default in this fork includes the replay of every
received real-device recording (laptop, phone, Mac, guided runs; they live in the private testbed's evidence repo,
never here) through the candidate build, scored per device next to the lab result, before the change is committed
here. A lab or public-dataset result without it is "lab only, not yet a decision". A change those recordings cannot
replay gets its record-only input added to the recording first. The decision, its numbers and their scope are
written in the private testbed (`docs/DECISIONS.md`, `docs/SDK-CHANGELOG.md`), not in this public repo.
