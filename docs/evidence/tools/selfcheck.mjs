// Shared self-check for the evidence scripts: an independent DFT, written here and not taken from the SDK, finds the
// strongest rate in a generated signal. A script calls checkRate() on its own input before it measures anything,
// so a generator bug (wrong units, wrong rate, wrong length) throws instead of producing a number.
// SELFCHECK_BREAK=1 shifts the expected rate by 10 bpm, so every script can be seen to throw once.

/** Strongest rate in bpm of `xs` sampled at `fs` Hz, searched 40 to 180 bpm in 0.25 bpm steps. */
export function peakBpm(xs, fs) {
	const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
	let best = 0;
	let bestBpm = 0;
	for (let bpm = 40; bpm <= 180; bpm += 0.25) {
		let re = 0;
		let im = 0;
		for (let i = 0; i < xs.length; i++) {
			const ph = (2 * Math.PI * bpm * i) / fs / 60;
			re += (xs[i] - mean) * Math.cos(ph);
			im += (xs[i] - mean) * Math.sin(ph);
		}
		if (re * re + im * im > best) {
			best = re * re + im * im;
			bestBpm = bpm;
		}
	}
	return bestBpm;
}

/** Throws unless `xs` (n samples at fs Hz) carries `bpm` within 2 bpm and has exactly `n` samples. */
export function checkRate(label, xs, fs, bpm, n) {
	const want = process.env.SELFCHECK_BREAK ? bpm + 10 : bpm;
	const got = peakBpm(xs, fs);
	if (Math.abs(got - want) > 2 || xs.length !== n)
		throw new Error(
			`self-check failed (${label}): input reads ${got} bpm over ${xs.length} samples, expected ${want} over ${n}`,
		);
	console.log(
		`self-check ok (${label}): input carries ${got} bpm (set ${bpm}), ${n} samples`,
	);
}
