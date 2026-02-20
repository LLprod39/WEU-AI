export let ysdk: any | null = null;
export let sdkReady = false;

/** Никогда не бросает. */
export function setYsdk(v: any | null): void {
  try {
    ysdk = v;
    sdkReady = v != null;
  } catch {
    // ignore
  }
}
