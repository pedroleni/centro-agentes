/// <reference types="vite/client" />
import './configurarZod.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './estilos.css'
import { claveDelEnlace, guardarClavePanel } from './logica/clavePanel.js'

// Enlace de arranque del panel local: guarda la clave y la quita de la URL (y del historial).
const clave = claveDelEnlace(window.location.hash)
if (clave !== null) {
  guardarClavePanel(clave)
  window.history.replaceState(null, '', '/#/')
}

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
