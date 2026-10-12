// The pulse check. A face with no pulse (or with one) through the SDK's own session path (DemoRunner, the
// multi-region fuser, RppgProcessor, RppgSession) with the real WASM core. Synthetic input only, Node 20 or later.
//
//   node no-pulse-session.mjs <pkgDir> [pulseBpm] [check]
//   e.g. node no-pulse-session.mjs node_modules/@elata-biosciences/rppg-web            published 0.14.0, no pulse
//        node no-pulse-session.mjs packages/rppg-web 0 check                            the test build, check on, every other fix off
//        node no-pulse-session.mjs packages/rppg-web 72 check                           the same with a true 72
//
// Good with no pulse is no number in any second. With a pulse, the check's first number arrives after about 18 to
// 22 s and is right. SELFCHECK_BREAK=1 makes the self-check throw on purpose.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { checkRate } from "../../tools/selfcheck.mjs";
const [DIR, BPM = "0", CHECK] = process.argv.slice(2); // CHECK=check: a build with PulseCheck, every other fix off
const sdk = await import(pathToFileURL(`${DIR}/dist/index.js`).href);
const wasm = readFileSync(`${DIR}/pkg/rppg_wasm_bg.wasm`);
const backend = await sdk.loadWasmBackend(
	async (u) => {
		const m = await import(u);
		m.initSync?.({ module: wasm });
		return m;
	},
	{ strict: true, jsUrl: pathToFileURL(`${DIR}/pkg/rppg_wasm.js`).href },
);
const source = { onFrame: null, async start() {}, async stop() {} };
const check = CHECK ? new sdk.PulseCheck() : null;
const off = CHECK ? { fixes: false } : {};
const processor = new sdk.RppgProcessor(backend, 30, 10, off);
const runner = new sdk.DemoRunner(source, processor, {
	sampleRate: 30,
	useSkinMask: true,
	...off,
	...(check ? { pulseChecker: check } : {}),
});
const session = new sdk.RppgSession(
	source,
	processor,
	runner,
	"wasm",
	"face_mesh",
	check ? { pulseCheck: check } : {},
);
await session.start();
// A 96 x 96 frame of skin colour with one grey level of sensor noise; forehead and both cheeks as the three regions.
const W = 96,
	H = 96,
	rois = [
		{ x: 33, y: 10, w: 30, h: 14 },
		{ x: 14, y: 40, w: 22, h: 22 },
		{ x: 60, y: 40, w: 22, h: 22 },
	];
// A face mesh: 478 points spread over the face box (the check needs the face mesh: no mesh, no proof).
const landmarks = Array.from({ length: 478 }, (_, i) => ({
	x: (10 + ((i % 22) / 21) * 76) / W,
	y: (5 + (Math.floor(i / 22) / 21) * 86) / H,
	z: 0,
}));
let s = 1;
const u = () =>
	((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 2 ** 32;
// Self-check: with a pulse asked for, the generated green carries it (60 s at 30 fps is 1,800 frames); with none,
// the same check on a 72 bpm copy of the generator must pass, so the generator itself is known to work.
{
	const bpm = Number(BPM) || 72;
	checkRate(
		"generated green",
		Array.from(
			{ length: 1800 },
			(_, i) =>
				130 * (1 - 0.77 * 0.01 * Math.sin((2 * Math.PI * bpm * i) / 30 / 60)),
		),
		30,
		bpm,
		1800,
	);
}
const shown = [];
for (let i = 0; i < 60 * 30; i++) {
	const t = (i * 1000) / 30;
	const q = Number(BPM)
		? 0.01 * Math.sin((2 * Math.PI * Number(BPM) * t) / 60000)
		: 0;
	const data = new Uint8ClampedArray(W * H * 4);
	for (let p = 0; p < W * H; p++) {
		data[4 * p] = 190 * (1 - 0.33 * q) + (u() - 0.5) * 2;
		data[4 * p + 1] = 130 * (1 - 0.77 * q) + (u() - 0.5) * 2;
		data[4 * p + 2] = 110 * (1 - 0.53 * q) + (u() - 0.5) * 2;
		data[4 * p + 3] = 255;
	}
	source.onFrame({
		data,
		width: W,
		height: H,
		rois,
		roi: { x: 10, y: 5, w: 76, h: 86 },
		landmarks,
		timestampMs: t,
	});
	if ((i + 1) % 30 === 0) {
		const m = session.getMetrics();
		shown.push(m.bpm == null ? "-" : Math.round(m.bpm));
	}
}
await session.stop();
console.log(
	`${sdk.RPPG_WEB_BUILD_VERSION ?? "published"}${check ? " with the check" : ""} ${Number(BPM) ? "pulse " + BPM : "no pulse"}: bpm each second: ${shown.join(" ")}`,
);
console.log(
	`seconds with a number: ${shown.filter((x) => x !== "-").length} of ${shown.length}`,
);
