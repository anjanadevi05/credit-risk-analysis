import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import toast from "react-hot-toast";
import './ForgetPassword.css';

const ForgetPassword = () => {
  const navigate = useNavigate();
  const [pass, setPass] = useState("");
  const [cpass, setCpass] = useState("");
  const [email] = useState(localStorage.getItem("resetEmail") || "");

  const checkPass = async () => {
    if (pass !== cpass) {
      toast.error("Password does not match.....", { position: "top-right", duration: 5000 });
    } else {
      try {
        const res = await axios.post("https://hrms-software.onrender.com/ResetPass", { email, newPassword: pass });
        toast.success(res.data.message, { position: "top-right", duration: 5000 });
        localStorage.removeItem("resetEmail");
        navigate("/");
      } catch (error) {
        toast.error(error.response?.data?.message || "Something went wrong", { position: "top-right", duration: 5000 });
      }
    }
  };

  return (
    <div className="forget-password-container">
      <div className="forget-password-card">
        <h2>Change Password</h2>
        <form>
          <div className="form-group">
            <label>New Password</label>
            <input
              type="password"
              required
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="Enter new password"
            />
          </div>

          <div className="form-group">
            <label>Confirm Password</label>
            <input
              type="password"
              required
              value={cpass}
              onChange={(e) => setCpass(e.target.value)}
              placeholder="Confirm new password"
            />
          </div>

          <div className="checkbox-container">
            <input type="checkbox" />
            <span>
              I accept the{" "}
              <span className="terms">Terms and Conditions</span>
            </span>
          </div>

          <button
            type="submit"
            onClick={(e) => { e.preventDefault(); checkPass(); }}
            className="btn-reset"
          >
            Reset Password
          </button>
        </form>
      </div>
    </div>
  );
};

export { ForgetPassword };
