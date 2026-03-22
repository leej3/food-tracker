import { FormEvent, useState } from "react";
import { supabase } from "../lib/supabase";

export const ResetPasswordPage = () => {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== passwordConfirm) {
      setError("Passwords must match.");
      return;
    }

    setWorking(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
    } else {
      setMessage("Password updated. You can continue to the app.");
    }
    setWorking(false);
  };

  return (
    <main className="page auth-page">
      <section className="auth-box">
        <h1>Set a new password</h1>
        <form onSubmit={submit} className="auth-form">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="New password"
          />
          <input
            type="password"
            value={passwordConfirm}
            onChange={(event) => setPasswordConfirm(event.target.value)}
            placeholder="Repeat password"
          />
          <button type="submit" disabled={working}>
            {working ? "Saving..." : "Update password"}
          </button>
        </form>
        {error ? <p className="error">{error}</p> : null}
        {message ? <p className="success">{message}</p> : null}
      </section>
    </main>
  );
};
