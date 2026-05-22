import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { ThemeProvider } from "./components/ui/theme-provider.tsx"
import './index.css'
import Navbar from './assets/Navbar.tsx'
import Home from './assets/Home.tsx'
import Scoreboard from './assets/Scoreboard.tsx'
import Simulator from './assets/Simulator.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <Navbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/live" element={<Scoreboard />} />
          <Route path="/simulate" element={<Simulator />} />
        </Routes>    
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
