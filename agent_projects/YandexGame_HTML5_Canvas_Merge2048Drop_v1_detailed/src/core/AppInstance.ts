import type { App } from './App';

let instance: App | null = null;

export function registerApp(a: App): void {
  instance = a;
}

export function getApp(): App {
  if (!instance) throw new Error('App not registered');
  return instance;
}
