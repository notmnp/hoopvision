import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from "react-router-dom"
import { ThemeProvider } from "./components/ui/theme-provider.tsx"
import './index.css'
import Home from './assets/Home.tsx'
import Navbar from './assets/Navbar.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <Navbar />
        <Home />    
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
