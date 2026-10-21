import { headCentre } from "../pulseCheck";
import { RecordingPulseCheck } from "../pulseCheckRecording";

/** 478 face-mesh points at the frame's centre, then the cheekbones 200 px apart and the inner lips `gap` px apart. */
function mesh(gap: number) {
	const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
	pts[234] = { x: 0.4, y: 0.5 };
	pts[454] = { x: 0.6, y: 0.5 };
	pts[13] = { x: 0.5, y: 0.6 };
	pts[14] = { x: 0.5, y: 0.6 + gap / 1000 };
	return pts;
}

describe("mouthOpen: the inner-lip gap as a share of face width, recorded for the talking step", () => {
	it("is the gap between landmarks 13 and 14 over the cheekbone distance", () => {
		const h = headCentre(mesh(30), 1000, 1000)!;
		expect(h.faceWidth).toBeCloseTo(200, 6);
		expect(h.mouthOpen).toBeCloseTo(30 / 200, 6);
		expect(headCentre(mesh(0), 1000, 1000)!.mouthOpen).toBeCloseTo(0, 6);
	});
	it("is absent, never invented, when the mesh lacks the lip landmarks", () => {
		const short = mesh(30).slice(0, 12);
		expect(headCentre(short, 1000, 1000)).toBeNull();
	});
	it("is kept in the recording as the head's fourth number, and a head without it keeps three", () => {
		const rec = new RecordingPulseCheck({});
		const rgb = { r: 0.5, g: 0.4, b: 0.3 } as never;
		rec.push(0, [rgb, rgb, rgb], undefined, "no-room", headCentre(mesh(30), 1000, 1000)!);
		rec.push(33, [rgb, rgb, rgb], undefined, "no-room", { x: 1, y: 2, faceWidth: 3 });
		const fs = rec.getRecording().events.filter((e) => e[0] === "f") as unknown[][];
		expect((fs[0][6] as number[]).length).toBe(4);
		expect((fs[0][6] as number[])[3]).toBeCloseTo(0.15, 6);
		expect(fs[1][6]).toEqual([1, 2, 3]);
	});
});
