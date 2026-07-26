"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/client-request";

export function FixtureSite({ version }: { version: "rc1" | "rc2" }) {
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState({ name: false, email: false });
  const [submitError, setSubmitError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextErrors = {
      name: !String(data.get("name") ?? "").trim(),
      email: !String(data.get("email") ?? "").trim(),
    };
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.email) {
      setSubmitError("");
      window.requestAnimationFrame(() => (nextErrors.name ? nameInput.current : emailInput.current)?.focus());
      return;
    }
    setSubmitError("");
    try {
      const response = await fetchWithTimeout(`/api/fixture/leads?version=${version}`, { method: "POST", body: JSON.stringify({ name: data.get("name"), email: data.get("email") }), headers: { "content-type": "application/json" } }, 10_000);
      // rc1 intentionally contains the bug: it shows success even when the
      // request fails. rc2 is the fixed build and must never claim success
      // unless the lead endpoint accepted the request.
      if (version === "rc2" && !response.ok) {
        setSubmitError("We could not send your request. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      if (version === "rc1") setSubmitted(true);
      else setSubmitError("We could not send your request. Please try again.");
    }
  };
  return (
    <main className="fixture">
      <nav aria-label="Site navigation"><strong>ACME OUTDOORS</strong><div><a href="#trips">Trips</a><a href="#about">About</a><a href="#contact">Contact</a></div></nav>
      <section id="about" className="fixture-hero"><div><span>Tailored journeys into the wild</span><h1>Adventure,{" "}<br />made simple.</h1><Link href="/fixture/contact">Plan my trip</Link></div><div className="fixture-sun" aria-hidden="true"><i /></div></section>
      <section id="trips" className="fixture-section" aria-labelledby="trips-title"><span>WAYS TO EXPLORE</span><h2 id="trips-title">Trip planning</h2><div className="fixture-cards"><article aria-label="Trip package"><b>01</b><h3>Weekend reset</h3><p>Two nights, one trail, zero logistics.</p></article><article aria-label="Trip package"><b>02</b><h3>Grand expedition</h3><p>A week shaped around your wild side.</p></article><article aria-label="Trip package"><b>03</b><h3>Family outside</h3><p>Small legs, big wonder, easier days.</p></article></div></section>
      <section id="contact" className="fixture-contact"><div><span>START HERE</span><h2>Plan something{" "}<br />worth remembering.</h2><p>Tell us where your imagination keeps going. We’ll take care of the route.</p></div><form onSubmit={submit} noValidate>{submitted ? <div className="fixture-success" role="status"><strong>We have your request.</strong><p>An Acme trip planner will be in touch.</p></div> : <>{(errors.name || errors.email) && <p className="form-message is-error" role="alert">Complete the highlighted field{errors.name && errors.email ? "s" : ""} before sending.</p>}<label htmlFor="fixture-name">Name</label><input ref={nameInput} id="fixture-name" name="name" aria-describedby={errors.name ? "name-error" : undefined} aria-invalid={errors.name || undefined} onChange={() => { if (errors.name) setErrors((current) => ({ ...current, name: false })); }} />{errors.name && <small id="name-error">Enter your name.</small>}<label htmlFor="fixture-email">Email</label><input ref={emailInput} id="fixture-email" name="email" type="email" aria-describedby={errors.email ? "email-error" : undefined} aria-invalid={errors.email || undefined} onChange={() => { if (errors.email) setErrors((current) => ({ ...current, email: false })); }} />{errors.email && <small id="email-error">Enter your email.</small>}{submitError && <p className="form-message is-error" role="alert">{submitError}</p>}<button type="submit">Send my request</button></>}</form></section>
      <footer><span>STAGING FIXTURE · {version.toUpperCase()}</span><span>Acme Outdoors © 2026</span></footer>
    </main>
  );
}
