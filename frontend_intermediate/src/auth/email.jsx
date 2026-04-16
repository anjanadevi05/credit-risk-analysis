import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./authProvider";
import axios from "axios";
import toast from "react-hot-toast";
import "./EnterEmailPage.css"; // Import the CSS file

const EnterEmailPage = () => {
  const { email, setEmail, setOTP } = useAuth();
  const navigate = useNavigate();

  const checkEmail = async () => {
    try {
      const res = await axios.post(
        "https://hrms-software.onrender.com/CheckMail",
        { recipitent_email: email }
      );

      sendOTP();
      setEmail(email);
      localStorage.setItem("resetEmail", email);
      navigate("/verification");
    } catch (error) {
      toast.error(error.response?.data?.message || "Something went wrong", {
        position: "top-right",
        duration: 4000,
      });
    }
  };

  const sendOTP = async () => {
    if (email) {
      const OTP = Math.floor(Math.random() * 9000 + 1000); // 4-digit OTP
      console.log(OTP)
      setOTP(OTP);
      setEmail(email);

      try {
  
        const res = await axios.post(
          "https://hrms-software.onrender.com/sendOTP",
          { OTP, recipitent_email: email }
        );
       
        toast.success(res.data.message, { position: "top-right", duration: 5000 });
      } catch (error) {
        toast.error(error.response?.data?.message || "Something went wrong", {
          position: "top-right",
          duration: 5000,
        });
      }
    }
  };

  return (
    <div className="enter-email-container">
      <div className="enter-email-card">
        <h2>Enter Email Address</h2>
        <p>Please enter your email address to receive an OTP.</p>
        <form>
          <div className="form-group">
            <label>Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
            />
          </div>
          <button
            type="submit"
            onClick={(e) => {
              e.preventDefault();
              checkEmail();
            }}
            className="btn-send-otp"
          >
            Send OTP
          </button>
        </form>
      </div>
    </div>
  );
};

export { EnterEmailPage };
