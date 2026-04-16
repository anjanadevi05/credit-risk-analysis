import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

import { BrowserRouter as Router} from 'react-router-dom';
import {Toaster} from "react-hot-toast";
import { AuthProvider } from './auth/authProvider.jsx'

createRoot(document.getElementById('root')).render(
  
    <StrictMode>
     
  <Router>
     <AuthProvider>
       <App />
   </AuthProvider>
    </Router>
    <Toaster/>
   
  </StrictMode>,
)
