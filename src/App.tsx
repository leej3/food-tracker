import { useEffect, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { FoodTrackerPage } from "./components/FoodTrackerPage";
import { LoginPage } from "./components/LoginPage";
import { ResetPasswordPage } from "./components/ResetPasswordPage";

const App = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [requiresPasswordReset, setRequiresPasswordReset] = useState(false);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const initializeSession = async () => {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();

      setSession(currentSession);
      setRequiresPasswordReset(
        Boolean(currentSession) && window.location.hash.includes("type=recovery"),
      );
      setInitializing(false);
    };

    void initializeSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);

      if (event === "PASSWORD_RECOVERY") {
        setRequiresPasswordReset(true);
      } else if (!nextSession) {
        setRequiresPasswordReset(false);
      } else if (!window.location.hash.includes("type=recovery")) {
        setRequiresPasswordReset(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  if (initializing) {
    return <p className="page-status">Starting food tracker…</p>;
  }

  if (requiresPasswordReset && session) {
    return <ResetPasswordPage />;
  }

  if (!session) {
    return <LoginPage />;
  }

  return <FoodTrackerPage session={session} />;
};

export default App;
