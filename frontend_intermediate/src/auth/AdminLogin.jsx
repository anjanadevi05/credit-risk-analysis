import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "./authProvider";
import "./LoginPage.css";

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

const LoginPage = () => {
  const Navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { loginAction } = useAuth();

  const actionSubmit = async (e) => {
    e.preventDefault();
    const data = { email, password };
    loginAction(data);
  };

  return (
    <div className="login-page-container">
      <div className="demo-login">
        <p className="font-semibold">Demo Login:</p>
        <p>Username: <code>noqu@gmail.com</code></p>
        <p>Password: <code>noqu</code></p>
      </div>

      <div className="login-container">
        <div className="login-card">
          <div className="login-logo">
            <div className="login-user-icon" aria-hidden>
              <UserIcon />
            </div>
            <h2>Login</h2>
          </div>

          <form onSubmit={actionSubmit} className="login-form">
            <div>
              <label>Email</label>
              <input
                type="email"
                required
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label>Password</label>
              <input
                type="password"
                required
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="forgot-password">
              <button type="button" onClick={() => Navigate("/Email")}>
                Forgot Password?
              </button>
            </div>

            <button type="submit" className="login-btn">
              Login
            </button>
          </form>

          <p className="login-footer">
            Don&apos;t have an account? <span>Contact Admin</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export { LoginPage };
