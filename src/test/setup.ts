// Node test setup: an in-memory IndexedDB (fake-indexeddb) on globalThis, so
// the local adapter runs unchanged. Node 24 already provides crypto.subtle,
// Blob, URL.createObjectURL with fetch() of blob: URLs, structuredClone and
// BroadcastChannel.
import 'fake-indexeddb/auto';
