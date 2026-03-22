import { FormEvent, useState } from "react";
import { supabase } from "../lib/supabase";

export const LoginPage = () => {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setWorking(true);

    if (!email || !password) {
      setError("Email and password are required.");
      setWorking(false);
      return;
    }

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) {
        setError(error.message);
      }
      setWorking(false);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      setError(error.message);
    } else {
      setMessage("Signup requested. Check your email for confirmation if required.");
    }

    setWorking(false);
  };

  const sendReset = async () => {
    if (!email) {
      setError("Enter email first to reset password.");
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/#type=recovery`,
    });
    if (error) {
      setError(error.message);
    } else {
      setMessage("Password reset link sent.");
    }
  };

  return (
    <main className="page auth-page">
      <section className="auth-box">
        <h1>Food Tracker</h1>
        <p>Email sign in or signup and start tracking nutrition.</p>
        <div className="auth-toggle">
          <button type="button" onClick={() => setMode("signin")} className={mode === "signin" ? "active" : ""}>
            Sign in
          </button>
          <button type="button" onClick={() => setMode("signup")} className={mode === "signup" ? "active" : ""}>
            Sign up
          </button>
        </div>
        <form onSubmit={submit} className="auth-form">
          <input
            type="email"
            inputMode="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
          />
          <button type="submit" disabled={working}>
            {working ? "Working..." : mode === "signin" ? "Sign in" : "Sign up"}
          </button>
        </form>
        <button type="button" className="link-button" onClick={sendReset}>
          Forgot password?
        </button>
        {error ? <p className="error">{error}</p> : null}
        {message ? <p className="success">{message}</p> : null}
      </section>
    </main>
  );
};
