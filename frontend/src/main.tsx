import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { ThemeProvider } from "./components/ui/theme-provider.tsx"
import { TooltipProvider } from "./components/ui/tooltip.tsx"
import { Analytics } from "@vercel/analytics/react"
import 'katex/dist/katex.min.css'
import './index.css'
import Navbar from './pages/Navbar.tsx'
import Home from './pages/Home.tsx'
import Scoreboard from './pages/Scoreboard.tsx'
import Simulator from './pages/Simulator.tsx'
import BracketSetup from './pages/BracketSetup.tsx'
import DraftWorkspace from './pages/DraftWorkspace.tsx'
import HowItWorksView from './pages/HowItWorksView.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
        <TooltipProvider delayDuration={200}>
          <div className="grain-layer" aria-hidden />
          <Navbar />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/live" element={<Scoreboard />} />
            <Route path="/simulate" element={<Simulator />} />
            <Route path="/bracket/:bracketId?" element={<BracketSetup />} />
            <Route path="/draft" element={<DraftWorkspace />} />
            <Route path="/how-it-works" element={<HowItWorksView />} />
          </Routes>
          <Analytics />
        </TooltipProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
