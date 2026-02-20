import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Игрок не видит техтекст: убираем console из production-бандла
        intro: "if(typeof window!=='undefined'){const n=()=>{};['log','info','debug','warn','error'].forEach(m=>{console[m]=n;});}",
      },
    },
  },
})
