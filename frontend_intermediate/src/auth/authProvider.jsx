import { createContext, useContext, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast"
import { useNavigate } from "react-router-dom"

const AuthContext = createContext();

const AuthProvider = ({ children }) => {

    const Navigate = useNavigate()

    const loginAction = async (data) => {
        // Mock local authentication to bypass the external API
        if (data.email === "noqu@gmail.com" && data.password === "noqu") {
            localStorage.setItem("authToken", "mocked-local-token-12345");
            toast.success("Login Successful", { position: 'top-right', duration: 5000 });
            Navigate("/FrontPage");
        } else {
            toast.error("User not found! Please use demo credentials.", { position: 'top-right', duration: 5000 });
        }
    }

    const [email, setEmail] = useState();
    const [otp, setOTP] = useState();


    return <AuthContext.Provider value={{ loginAction, email, setEmail, setOTP, otp }}>{children}</AuthContext.Provider>

}


const useAuth = () => {

    return useContext(AuthContext)
}

export { useAuth, AuthProvider }
