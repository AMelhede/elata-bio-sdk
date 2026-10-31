import { PulseCheck } from "../pulseCheck";

// The check's read-outs the session's getGuideInput uses: the face's colour and the head rows, from its own frames.
describe("PulseCheck.faceColour and headRows", () => {
	it("gives green and blue over red of the three regions over the last window, null before frames", () => {
		const c = new PulseCheck();
		expect(c.faceColour()).toBeNull();
		for (let t = 0; t < 3000; t += 100) {
			const px = { r: 1, g: t < 1000 ? 0.9 : 0.3, b: t < 1000 ? 0.9 : 0.25 };
			c.push(t, [px, px, px]);
		}
		const col = c.faceColour(1000);
		expect(col?.greenOverRed).toBeCloseTo(0.3, 5);
		expect(col?.blueOverRed).toBeCloseTo(0.25, 5);
	});
	it("keeps the head rows of the window asked for", () => {
		const c = new PulseCheck();
		const px = { r: 0.6, g: 0.4, b: 0.3 };
		for (let t = 0; t < 10_000; t += 100) c.push(t, [px, px, px], undefined, undefined, { x: 100 + t / 1000, y: 100, faceWidth: 80 });
		const rows = c.headRows(2000);
		expect(rows[0][0]).toBeGreaterThanOrEqual(7900);
		expect(rows[rows.length - 1][0]).toBe(9900);
		expect(rows[0].length).toBe(4);
	});
});
