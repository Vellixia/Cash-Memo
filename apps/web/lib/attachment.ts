/** Client-side prep for a receipt/photo attachment before it's uploaded. */
import type { AttachmentContentType } from "@/lib/api";

const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

/** Downscales to at most 1600px on the long edge and re-encodes as JPEG (~0.8 quality). This
 * also strips EXIF; `imageOrientation: "from-image"` bakes the original rotation in first, so
 * the result still displays right-side up everywhere. Throws a message fit to show the user. */
export async function processAttachment(file: File): Promise<{ blob: Blob; contentType: AttachmentContentType }> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  if (file.size > MAX_INPUT_BYTES) throw new Error("That image is larger than 20 MB");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Could not read that image");
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process that image");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("Could not process that image");
    return { blob, contentType: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}
