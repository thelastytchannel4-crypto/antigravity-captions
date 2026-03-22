import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  // Remove React.StrictMode to avoid double rendering during complex initialization
  // like FFmpeg or Web Workers in development.
  <App />
)
