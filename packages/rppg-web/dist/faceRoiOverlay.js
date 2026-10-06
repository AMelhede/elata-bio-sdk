import { ELATA_FACE_YCBCR_V1_FRACTIONS, ELATA_FACE_YCBCR_V1_PROFILE, FUSION_ROI_NAMES, computeFractionalFaceRoiRects, } from "./roiProfile.js";
export { ELATA_FACE_YCBCR_V1_FRACTIONS as FACE_ROI_FRACTIONS, FUSION_ROI_NAMES, } from "./roiProfile.js";
/**
 * Face ROI geometry plus a canvas debug overlay. The default geometry preserves
 * the SDK's existing rectangles; alternative profiles can be selected explicitly.
 */
/** @deprecated Internal alias retained for readability below. */
const DEFAULT_OVERLAY_ROIS = FUSION_ROI_NAMES;
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
/**
 * Pixel rectangles for each named face ROI, derived from the 5th/95th-percentile
 * bounding box of the landmarks. This compatibility wrapper preserves the
 * original SDK API; new code may use a {@link RoiGeometryProfile} directly.
 */
export function computeFaceRoiRects(landmarks, width, height, fractions = ELATA_FACE_YCBCR_V1_FRACTIONS) {
    return computeFractionalFaceRoiRects(landmarks, width, height, fractions);
}
/**
 * Ordered forehead and cheek sub-ROIs sampled for the pulse signal.
 */
export function computeFusionSubRois(landmarks, width, height, profile = ELATA_FACE_YCBCR_V1_PROFILE) {
    const rects = profile.compute(landmarks, width, height);
    const out = [];
    for (const name of FUSION_ROI_NAMES) {
        const rect = rects[name];
        if (rect)
            out.push(rect);
    }
    return out;
}
/**
 * Draw the face mesh tessellation and rPPG ROI boxes onto a 2D canvas.
 */
export function drawFaceOverlay(ctx, landmarks, width, height, options = {}) {
    if (!landmarks.length || width <= 0 || height <= 0)
        return;
    const { tessellation, weights, mirrored = true, geometryProfile = ELATA_FACE_YCBCR_V1_PROFILE, } = options;
    const rois = options.rois ?? DEFAULT_OVERLAY_ROIS;
    if (tessellation && tessellation.length) {
        ctx.save();
        ctx.strokeStyle = "rgba(120,230,255,0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const connection of tessellation) {
            const start = landmarks[connection.start];
            const end = landmarks[connection.end];
            if (!start || !end)
                continue;
            ctx.moveTo(start.x * width, start.y * height);
            ctx.lineTo(end.x * width, end.y * height);
        }
        ctx.stroke();
        ctx.restore();
    }
    const drawLabel = (text, cx, y, color) => {
        ctx.save();
        ctx.translate(cx, y);
        if (mirrored)
            ctx.scale(-1, 1);
        ctx.font = "11px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = color;
        ctx.fillText(text, 0, 0);
        ctx.restore();
    };
    const rects = geometryProfile.compute(landmarks, width, height);
    for (const roi of rois) {
        const rect = rects[roi];
        if (!rect)
            continue;
        const weight = weights ? clamp(weights[roi] ?? 0, 0, 1) : 1 / rois.length;
        ctx.save();
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5 + 2.5 * weight;
        ctx.strokeStyle = `rgba(34,197,94,${(0.35 + 0.6 * weight).toFixed(3)})`;
        ctx.fillStyle = `rgba(34,197,94,${(0.05 + 0.35 * weight).toFixed(3)})`;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        ctx.restore();
        const label = weights ? `${roi} ${Math.round(weight * 100)}%` : roi;
        drawLabel(label, rect.x + rect.w / 2, rect.y + 12, "rgba(187,247,208,0.95)");
    }
}
