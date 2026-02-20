import './style.css';
import { DesktopUI } from '../../src/system/DesktopUI.ts';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) {
  throw new Error('Cannot find #app root element.');
}

const desktop = new DesktopUI(appRoot, {
  icons: [
    { id: 'my-computer', label: 'This PC', glyph: 'PC', tint: '#7ee8ff', appKind: 'file-manager', startPath: '/' },
    {
      id: 'documents',
      label: 'Documents',
      glyph: 'DC',
      tint: '#a8ffdb',
      appKind: 'file-manager',
      startPath: '/Users/Guest/Documents',
    },
    {
      id: 'notepad',
      label: 'Text Editor',
      glyph: 'TX',
      tint: '#ffd07f',
      appKind: 'text-editor',
      startPath: '/Users/Guest/Documents/Untitled.txt',
    },
    { id: 'edge', label: 'Edge', glyph: 'EG', tint: '#89b8ff' },
    { id: 'code', label: 'Code', glyph: 'VS', tint: '#8ab2ff' },
    { id: 'paint', label: 'Paint', glyph: 'PT', tint: '#ffb88c' },
    { id: 'settings', label: 'Settings', glyph: 'ST', tint: '#dac4ff' },
  ],
});

desktop.mount();
