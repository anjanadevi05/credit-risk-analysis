import React from "react";
import { Navigate,Outlet } from "react-router-dom";


const PrivateRoute=()=>{

    const token = localStorage.getItem("authToken");
    if(!token)
    {
        return <Navigate to="/" />;
    }
    return <Outlet/>
}


export {PrivateRoute}