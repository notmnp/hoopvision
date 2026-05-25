import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { ThemeProvider } from "./components/ui/theme-provider.tsx"
import { TooltipProvider } from "./components/ui/tooltip.tsx"
import './index.css'
import Navbar from './pages/Navbar.tsx'
import Home from './pages/Home.tsx'
import Scoreboard from './pages/Scoreboard.tsx'
import Simulator from './pages/Simulator.tsx'
import BracketSetup from './pages/BracketSetup.tsx'
import BracketView from './pages/BracketView.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <TooltipProvider delayDuration={200}>
          <Navbar />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/live" element={<Scoreboard />} />
            <Route path="/simulate" element={<Simulator />} />
            <Route path="/bracket" element={<BracketSetup />} />
            <Route path="/bracket/:bracketId" element={<BracketView />} />
          </Routes>
        </TooltipProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
