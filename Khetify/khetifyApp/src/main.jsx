import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ScrollToTop from './Components/ScrollToTop'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* Must sit INSIDE the router (it reads useLocation) and BEFORE <App/>,
          so the scroll is reset before the new page paints. Renders nothing. */}
      <ScrollToTop />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)