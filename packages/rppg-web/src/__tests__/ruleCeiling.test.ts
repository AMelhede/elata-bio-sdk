import { PULSE_CHECK_RULE_NAMES } from "../pulseCheck";

// The pulse check's rules are patches around a design that does not yet track the rate over time (the one-model tracker
// that replaces them is the planned redesign). A growing list of special-case rules is the sign the design is wrong, so
// the count may not grow by accident: adding a rule fails this test until its author raises the ceiling here on purpose
// AND records the rule as named debt (expiry and the tracker case that deletes it) in the private ledger. Deleting a rule
// lowers the ceiling. Set 2026-11-06 at 25 (22 on the 5th, plus allPatches, fpsCeiling, harmonicStart); 26 the same
// day for rule tracker, the mechanism itself, and back to 25 when rule trackLine, which it supersedes, was deleted.
// 24 the same day: harmonicStart deleted (its case passes on the tracker). When the tracker passes its gate, the rules
// it replaces are deleted. 25 on 2026-11-10 for skinFallback (off; named debt in evsave TRIED FB2a and QUEUE FB2-M:
// deleted when skin is found from the mesh's own skin colour). 26 on 2026-11-11 for startEvidence (off; part of the
// tracker, not a guard around it: the growing window judged alone against the prior. Its switch is deleted, the tracker
// always doing it, or its code removed, by its expiry; evsave TRIED FB3). 27 on 2026-11-11 for localSpread (off; named
// debt: the line over its own local spread, for windows a movement burst falls inside. Deleted, the line always read
// that way, or its code removed, by its expiry; evsave TRIED ML4).
const RULE_CEILING = 27;

describe("rule ceiling", () => {
	it("the count of the pulse check's rules never grows without a deliberate change here", () => {
		expect(PULSE_CHECK_RULE_NAMES.length).toBeLessThanOrEqual(RULE_CEILING);
	});
});
