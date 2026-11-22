import { COVER_TARGET_BYTES } from '../data';

/** Every new cover photo (cropped or whole): at most 800 px on its long side, JPEG ~0.8, at most COVER_TARGET_BYTES. */
export const COVER_PHOTO = { maxEdge: 800, quality: 0.8, maxBytes: COVER_TARGET_BYTES } as const;
