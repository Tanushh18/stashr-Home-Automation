import React from "react";
import ServiceStatus from "../ServiceStatus/ServiceStatus";
import AuthScene from "./AuthScene";
import { Immersive } from "../../three/Immersive";
import { LOADERS } from "../../three/loaders";
import useThemeName from "../../three/useThemeName";
import "../../styles/auth.css";

const COPY = {
  signin: { kicker: "Arrivals", title: <>Welcome back to your <em>secure world.</em></>, gate: "Vault" },
  signup: { kicker: "New arrival", title: <>Your digital world <em>starts here.</em></>, gate: "Registration" },
  forgot: { kicker: "Assistance desk", title: <>Let's get you back <em>on board.</em></>, gate: "Recovery" }
};

/**
 * The "arrival gate": a lounge-window scene (waterfall, river, jungle, runway, skyline) beside a calm form card.
 * On narrow screens the scene becomes a compact header above the form. Used by sign in, sign up and forgot password.
 */
export default function AuthShell({ stage, children, loading, aside, variant = "signin" }) {
  const copy = COPY[variant] || COPY.signin;
  const status = loading ? "Boarding" : "Ready";
  const theme = useThemeName();
  return (
    <div className={`auth auth--${variant}`}>
      <section className="auth__scene" aria-hidden="true">
        {/* Vault facility in 3D (immersive mode); the door unlocks while a sign-in request runs. */}
        <Immersive className="auth__scene-3d" load={LOADERS.vault} opts={{ theme, variant: "facility", unlock: !!loading }} fallback={<AuthScene />} />
        <span className="auth__scene-shade" />
        <div className="auth__scene-copy">
          <p className="auth__kicker">{copy.kicker}</p>
          <p className="auth__headline">{aside?.title || copy.title}</p>
          <p className="auth__tagline">{aside?.body || "Your Digital World. Protected. Connected. Effortless."}</p>
        </div>
        <div className="auth__board">
          <span><small>Gate</small><b>{copy.gate}</b></span>
          <span><small>Status</small><b className={loading ? "is-busy" : "is-ready"}>{status}</b></span>
          <span className="auth__board-extra"><small>Security</small><b>AES-256-GCM</b></span>
        </div>
      </section>

      <main className="auth__panel">
        <div className="auth__card">
          {loading && (
            <div className="auth__progress">
              <span className="auth__progress-fill" />
            </div>
          )}
          {stage ? (
            <p className={`auth__stage auth__stage--${stage.tone || "accent"}`}>
              <span className="auth__stage-dot" />
              {stage.label}
            </p>
          ) : null}
          {children}
          <p className="auth__note">
            Vault items are encrypted on our server with AES-256-GCM; your sign-in password is stored only as a bcrypt hash.
          </p>
          <div className="auth__status">
            <ServiceStatus compact />
          </div>
        </div>
      </main>
    </div>
  );
}
