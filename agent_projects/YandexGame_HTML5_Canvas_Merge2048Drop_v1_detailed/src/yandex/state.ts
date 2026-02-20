let ysdk: any | null = null;
let sdkReady = false;

export function setYsdk(v: any): void {
  ysdk = v;
  sdkReady = v != null;
}

export function getYsdk(): any | null {
  return ysdk;
}

export { sdkReady };
