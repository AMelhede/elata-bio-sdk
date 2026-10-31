/**
 * Camera helpers every camera heart-rate app needs, with no runtime imports (also from
 * `@elata-biosciences/rppg-web/camera`): keep the screen on while reading, move off an infrared camera that gives a grey
 * picture, and drop to a lower resolution when the device cannot keep up.
 */
export * from "./wakeLock.js";
export * from "./greyCamera.js";
export * from "./hdWatch.js";
export * from "./cameraReturn.js";
