export interface CropRef {
  id: string;
  bytes: number;
}

export interface BatchLimits {
  maxImagesPerRequest: number;
  maxRequestBytes: number;
  maxImagesPerJob: number;
}

/** Multipart framing (boundary, part headers, filename) per image, counted against the request limit. */
const MULTIPART_OVERHEAD_BYTES = 2_048;

/**
 * Greedy, order-preserving. A batch closes at the image count, or when the next
 * crop would push the body past `maxRequestBytes`. A crop that is too big even
 * on its own still goes alone: the server rejects it and the pass reports it,
 * which beats dropping it silently. Crops past `maxImagesPerJob` are `deferred`
 * and keep their local reading.
 */
export function planBatches(
  crops: readonly CropRef[],
  limits: BatchLimits,
): { batches: string[][]; deferred: string[] } {
  const batched = crops.slice(0, limits.maxImagesPerJob);
  const deferred = crops.slice(limits.maxImagesPerJob).map((crop) => crop.id);

  const batches: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const crop of batched) {
    const size = crop.bytes + MULTIPART_OVERHEAD_BYTES;
    const full = current.length >= limits.maxImagesPerRequest;
    const tooBig = current.length > 0 && currentBytes + size > limits.maxRequestBytes;
    if (full || tooBig) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(crop.id);
    currentBytes += size;
  }
  if (current.length > 0) batches.push(current);
  return { batches, deferred };
}
