import type { CreateRppgSessionOptions } from "./rppgSession.js";
export declare function initDemo(videoEl: HTMLVideoElement, opts?: Omit<CreateRppgSessionOptions, "video">): Promise<{
    source: import("./frameSource.js").FrameSource;
    proc: import("./workerRppgProcessor.js").RppgProcessorLike;
    runner: import("./demoRunner.js").DemoRunner;
    session: import("./rppgSession.js").RppgSession;
}>;
//# sourceMappingURL=demoApp.d.ts.map