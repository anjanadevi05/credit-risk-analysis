import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./authProvider";
import axios from "axios";
import toast from "react-hot-toast";
import "./EmailVerificationPage.css";

const EmailVerificationPage = () => {
  const { email, setEmail, setOTP, otp } = useAuth();
  const [OTPinput, setOTPinput] = useState(["", "", "", ""]);
  const [timeCount, setTimer] = useState(30);
  const [disable, setDisable] = useState(true);

  const navigate = useNavigate();

  // Verify OTP
  const verifyOTP = () => {
    if (parseInt(OTPinput.join("")) === otp) {
      toast.success("OTP verified successfully...", { position: "top-right", duration: 4000 });
      navigate("/forgetPassword");
    } else {
      toast.error("Invalid OTP...", { position: "top-right", duration: 4000 });
    }
  };

  // Resend OTP
  const sendOTP = async () => {
    try {
      const res = await axios.post("https://hrms-software.onrender.com/sendOTP", {
        OTP: otp,
        recipitent_email: email,
      });
      toast.success(res.data.message, { position: "top-right", duration: 5000 });
      setTimer(60);
      setDisable(true);
    } catch (error) {
      toast.error(error.response?.data?.message || "Something went wrong", {
        position: "top-right",
        duration: 5000,
      });
    }
  };

  // OTP countdown timer
  useEffect(() => {
    let interval;
    if (disable) {
      interval = setInterval(() => {
        setTimer((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            setDisable(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [disable]);

  // Auto-focus first input on mount
  useEffect(() => {
    const firstInput = document.querySelectorAll(".otp-input-container input")[0];
    if (firstInput) firstInput.focus();
  }, []);

  return (
    <div className="email-verification-container">
      <div className="email-verification-card">
        <h2>Email Verification</h2>
        <p>
          We have sent a code to your email{" "}
          <span className="font-medium">
            {localStorage.getItem("resetEmail")}
            <button onClick={() => navigate("/Email")} className="email-edit-btn">
              ✏️
            </button>
          </span>
        </p>

        <div className="otp-input-container">
          {OTPinput.map((digit, index) => (
            <input
              key={index}
              type="text"
              maxLength="1"
              value={OTPinput[index]}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9]/g, "");
                const newOTP = [...OTPinput];
                newOTP[index] = val;
                setOTPinput(newOTP);

                // Auto-focus next input
                if (val && index < OTPinput.length - 1) {
                  const nextInput = document.querySelectorAll(".otp-input-container input")[index + 1];
                  nextInput.focus();
                }
              }}
            />
          ))}
        </div>

        <button onClick={verifyOTP} className="btn-verify">
          Verify Account
        </button>

        <p className="resend-otp">
          Didn’t receive a code?{" "}
          <button
            onClick={sendOTP}
            disabled={disable}
            className={disable ? "disabled" : "enabled"}
          >
            {disable ? `Resend OTP in ${timeCount}s` : "Resend OTP"}
          </button>
        </p>
      </div>
    </div>
  );
};

export { EmailVerificationPage };
