// The package's own demo page is the first thing a developer opens. It showed the raw engine's rate
// (smoothed and unsmoothed), a mood read from the face and HRV, a breathing rate, and the engine's
// confidence and signal quality: none of these passed a check against a reference, and signal quality
// read 100% while a rate was invented. The page shows the session's checked heart rate and nothing
// that claims more, as the generated heart-rate demo already does (create-elata-demo's own test).

// Jest provides require and __dirname; this package's tests carry no Node type declarations.
declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require("fs") as { readFileSync: (p: string, enc: string) => string };
const path = require("path") as { join: (...p: string[]) => string };

const main = fs.readFileSync(path.join(__dirname, "..", "..", "demo", "main.ts"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "..", "demo", "index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "demoApp.ts"), "utf8");

describe("the SDK demo page", () => {
	it("shows the session's checked heart rate", () => {
		expect(main).toMatch(/session\.getMetrics\(\)/);
		expect(main).not.toMatch(/emaBpm|rawBpm/);
	});

	it.each([
		["a mood reader", /AffectTracker|classifyAffectLabel|affect-/],
		["HRV", /hrv_rmssd/],
		["a breathing rate", /respiration_rate|resp-rate/],
		["the engine's confidence or signal quality as a number", /confEl|signalEl|agreementEl|signal-quality-badge/],
	])("shows no %s", (_what, pattern) => {
		expect(main).not.toMatch(pattern);
		expect(html).not.toMatch(pattern);
	});

	it("does not run the engine's rate tracker, which no longer moves the rate the page shows", () => {
		expect(app).toMatch(/enableTracker: false/);
	});

	it("says when no face is in view and when it is still looking for a pulse", () => {
		expect(main).toContain("lastDropReason === 'no_face'");
		expect(main).toContain("Looking for a pulse");
	});
});
