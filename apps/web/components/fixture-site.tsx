"use client";

import { FormEvent, useState } from "react";

export function FixtureSite({ version }: { version: "rc1" | "rc2" }) {
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!data.get("name") || !data.get("email")) { setErrors(true); return; }
    setErrors(false);
    await fetch(`/api/fixture/leads?version=${version}`, { method: "POST", body: JSON.stringify({ name: data.get("name"), email: data.get("email") }), headers: { "content-type": "application/json" } });
    // rc1 intentionally contains the bug: it shows success even when the request fails.
    setSubmitted(true);
  };
  return (
    <main className="fixture">
      <nav aria-label="Site navigation"><strong>ACME OUTDOORS</strong><div><a href="#trips">Trips</a><a href="#about">About</a><a href="#contact">Contact</a></div></nav>
      <section id="about" className="fixture-hero"><div><span>Tailored journeys into the wild</span><h1>Adventure,<br />made simple.</h1><a href="#contact" role="button">Plan my trip</a></div><div className="fixture-sun" aria-hidden="true"><i /></div></section>
      <section id="trips" className="fixture-section" aria-labelledby="trips-title"><span>WAYS TO EXPLORE</span><h2 id="trips-title">Trip planning</h2><div className="fixture-cards"><article aria-label="Trip package"><b>01</b><h3>Weekend reset</h3><p>Two nights, one trail, zero logistics.</p></article><article aria-label="Trip package"><b>02</b><h3>Grand expedition</h3><p>A week shaped around your wild side.</p></article><article aria-label="Trip package"><b>03</b><h3>Family outside</h3><p>Small legs, big wonder, easier days.</p></article></div></section>
      <section id="contact" className="fixture-contact"><div><span>START HERE</span><h2>Plan something<br />worth remembering.</h2><p>Tell us where your imagination keeps going. We’ll take care of the route.</p></div><form onSubmit={submit} noValidate>{submitted ? <div className="fixture-success" role="status"><strong>We have your request.</strong><p>An Acme trip planner will be in touch.</p></div> : <><label htmlFor="fixture-name">Name</label><input id="fixture-name" name="name" aria-describedby={errors ? "name-error" : undefined} />{errors && <small id="name-error">Enter your name.</small>}<label htmlFor="fixture-email">Email</label><input id="fixture-email" name="email" type="email" aria-describedby={errors ? "email-error" : undefined} />{errors && <small id="email-error">Enter your email.</small>}<button type="submit">Send my request</button></>}</form></section>
      <footer><span>STAGING FIXTURE · {version.toUpperCase()}</span><span>Acme Outdoors © 2026</span></footer>
    </main>
  );
}
