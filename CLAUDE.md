# elata-bio-sdk fork: working instructions

## No decision before a replay on our own real recordings

Every keep, reject, ship or tune decision on a rule, a bar or a default in this fork includes the replay of every
received real-device recording (laptop, phone, Mac, guided runs; they live in the private testbed's evidence repo,
never here) through the candidate build, scored per device next to the lab result, before the change is committed
here. A lab or public-dataset result without it is "lab only, not yet a decision". A change those recordings cannot
replay gets its record-only input added to the recording first. The decision, its numbers and their scope are
written in the private testbed (`docs/DECISIONS.md`, `docs/SDK-CHANGELOG.md`), not in this public repo.

## Proven Better New means the same function in the proven product, judged on the owner's goal (owner, 2026-10-30)
A change justified as "proven" copies the proven product that does the SAME job, not a neighbour: a live heart rate
copies a live heart rate app (Apple Heart Rate: "Measuring" until the first number, then each number as soon as it is
there, old ones marked with their age), never a timed medical spot check (Apple ECG 30 s, Blood Oxygen 15 s), whose
fixed length exists for the protocol. Before shipping, score it on the owner's stated goal (more readings, sooner,
steady), not on a proxy that looks better (one summary number's accuracy). Never change what testers see right after
the owner has described the page to them without his word. Learned when a forced 60 s reading shipped as "proven" and
was reverted the same hour.

## Musk's algorithm with the idiot index, on every piece of work, in every repo (owner, 2026-10-30)
Order is the point: 1) make each requirement less dumb, each with the name of the person who set it (no name, no
requirement); 2) delete parts and steps hard, and add back at least 1 in 10, or not enough was deleted (keep an add-back
ledger); 3) simplify or optimise only what survived; 4) speed up the cycle; 5) automate last. Before optimising anything,
compute its idiot index: what it costs now against its physics floor (seconds to first number against the few heartbeats
a rate needs, frames analysed against what the camera delivers, readings per minute against a wearable's, lines of code
against the job's minimum, owner steps per test against zero). A high ratio marks where to delete or redesign first.
