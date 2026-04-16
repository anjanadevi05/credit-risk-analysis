import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import './App.css'
import { FrontPage } from './dashboard/FrontPage'
import { Gauge } from './assets/meter/gauge'
import { AdvancedDashboard } from './dashboard/AdvancedDashboard'

import { PrivateRoute } from './layout/Private.jsx'
import { LoginPage } from './auth/AdminLogin.jsx'
import { EnterEmailPage} from './auth/email.jsx'
import { EmailVerificationPage } from './auth/emialVerification.jsx'
import { ForgetPassword } from './auth/ForgetPassword.jsx' 

function App() {
  useEffect(() => {
    document.title = "Credit Risk Analysis";
  }, []);

  return (


  <Routes>
    <Route index path='/' element={<LoginPage/>} />
    <Route path='/Email' element={<EnterEmailPage/>}/>
    <Route path='/forgetPassword' element={<ForgetPassword />}/>
    <Route path='/verification' element={<EmailVerificationPage/>}/>
    <Route element={<PrivateRoute/>}>
    
        <Route index path='/FrontPage' element={<FrontPage/>} />
      <Route path='/advanced' element={<AdvancedDashboard/>}/>
      <Route path='/gauge' element={<Gauge/>}/>
    </Route>
  </Routes>
  )
}

export default App
