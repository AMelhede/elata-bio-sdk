// The trial face finder must fail as loudly as the published loader: a face finder that cannot be built is
// an error the session reports (face_mesh_init_failed), never a silent fall-back to reading the middle of the
// picture.

const build: { fail: Set<string>; message: string } = { fail: new Set(), message: "" };

jest.mock(
	"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs",
	() => ({
		FilesetResolver: { forVisionTasks: async () => ({}) },
		FaceLandmarker: {
			createFromOptions: async (_fileset: unknown, opts: { baseOptions: { delegate?: string } }) => {
				const delegate = opts.baseOptions.delegate ?? "CPU";
				if (build.fail.has(delegate)) throw new Error(`${build.message} (${delegate})`);
				return { detectForVideo: () => ({ faceLandmarks: [] }), close: () => undefined };
			},
		},
	}),
	{ virtual: true },
);

import { loadFaceLandmarker, loadTrialFaceFinder } from "../mediapipeLoader";

beforeEach(() => {
	build.fail = new Set();
	build.message = "Failed to fetch model: face_landmarker.task (404)";
});

test("no delegate builds: the trial loader throws the build error, as the published loader does", async () => {
	build.fail = new Set(["GPU", "CPU"]);
	await expect(loadFaceLandmarker()).rejects.toThrow("Failed to fetch model");
	await expect(loadTrialFaceFinder()).rejects.toThrow("Failed to fetch model");
});

test("one delegate fails: the other is used, and nothing is thrown", async () => {
	build.fail = new Set(["GPU"]);
	const f = await loadTrialFaceFinder();
	expect(f).not.toBeNull();
	expect(f!.delegate).toBe("CPU");
});
