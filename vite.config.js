import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: 'https://github.com/contabilidade-kdw/Gestao-Precificacao.git', // Ou '/NOME-DO-REPO/'
})