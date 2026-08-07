import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './utils/authFetch.js' // must run before any component fetches — patches window.fetch for cookie+CSRF auth
import './index.css'
import AppRouter from './AppRouter.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
)
