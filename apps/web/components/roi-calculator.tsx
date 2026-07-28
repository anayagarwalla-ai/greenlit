"use client";

import { useMemo, useState } from "react";
import { Calculator, Clock3, ReceiptText, RotateCcw } from "lucide-react";

function validNumber(value: string, maximum: number) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maximum) return null;
  return parsed;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function RoiCalculator() {
  const [milestones, setMilestones] = useState("8");
  const [hours, setHours] = useState("2.5");
  const [rate, setRate] = useState("125");
  const [days, setDays] = useState("5");
  const [improvement, setImprovement] = useState("35");

  const parsed = useMemo(() => ({
    monthlyMilestones: validNumber(milestones, 1000),
    chaseHours: validNumber(hours, 100),
    hourlyRate: validNumber(rate, 5000),
    delayDays: validNumber(days, 365),
    improvement: validNumber(improvement, 100),
  }), [days, hours, improvement, milestones, rate]);

  const result = useMemo(() => {
    const { monthlyMilestones, chaseHours, hourlyRate, delayDays, improvement: validImprovement } = parsed;
    if (
      monthlyMilestones === null
      || chaseHours === null
      || hourlyRate === null
      || delayDays === null
      || validImprovement === null
    ) return null;
    const improvementRate = validImprovement / 100;
    const hoursRecovered = monthlyMilestones * chaseHours * improvementRate;
    return {
      hoursRecovered,
      valueRecovered: hoursRecovered * hourlyRate,
      approvalDaysRecovered: monthlyMilestones * delayDays * improvementRate,
    };
  }, [parsed]);

  const reset = () => {
    setMilestones("8");
    setHours("2.5");
    setRate("125");
    setDays("5");
    setImprovement("35");
  };

  return (
    <section className="roi-calculator" aria-labelledby="roi-title">
      <div className="roi-calculator__inputs">
        <div className="resource-section__eyebrow"><Calculator size={15} /> Your current workflow</div>
        <h2 id="roi-title">Estimate the approval drag</h2>
        <p>Use conservative inputs. This is a planning model, not a promised Greenlit result.</p>
        <div className="roi-fields">
          <label>
            Milestones completed per month
            <input type="number" min="0" max="1000" step="1" value={milestones} aria-invalid={parsed.monthlyMilestones === null} aria-describedby={parsed.monthlyMilestones === null ? "roi-input-error" : undefined} onChange={(event) => setMilestones(event.target.value)} />
          </label>
          <label>
            Team hours spent preparing and chasing each approval
            <input type="number" min="0" max="100" step="0.25" value={hours} aria-invalid={parsed.chaseHours === null} aria-describedby={parsed.chaseHours === null ? "roi-input-error" : undefined} onChange={(event) => setHours(event.target.value)} />
          </label>
          <label>
            Blended team value per hour
            <span className="roi-input-prefix"><span aria-hidden="true">$</span><input aria-label="Blended team value per hour in dollars" type="number" min="0" max="5000" step="5" value={rate} aria-invalid={parsed.hourlyRate === null} aria-describedby={parsed.hourlyRate === null ? "roi-input-error" : undefined} onChange={(event) => setRate(event.target.value)} /></span>
          </label>
          <label>
            Average days from completion to approval
            <input type="number" min="0" max="365" step="0.5" value={days} aria-invalid={parsed.delayDays === null} aria-describedby={parsed.delayDays === null ? "roi-input-error" : undefined} onChange={(event) => setDays(event.target.value)} />
          </label>
          <label>
            Conservative improvement to model
            <span className="roi-input-prefix roi-input-prefix--suffix"><input aria-label="Conservative improvement percentage" type="number" min="0" max="100" step="1" value={improvement} aria-invalid={parsed.improvement === null} aria-describedby={parsed.improvement === null ? "roi-input-error" : undefined} onChange={(event) => setImprovement(event.target.value)} /><span aria-hidden="true">%</span></span>
            <small>Editable hypothesis only; Greenlit has not established a customer benchmark.</small>
          </label>
        </div>
        <button className="text-action roi-reset" type="button" onClick={reset}><RotateCcw size={14} /> Reset assumptions</button>
      </div>
      <div className="roi-calculator__result" aria-live="polite">
        <span className="resource-section__eyebrow">Monthly planning estimate</span>
        {!result && <p id="roi-input-error" className="roi-input-error" role="status"><strong>Estimate unavailable.</strong> Use zero or a positive value no higher than each field allows.</p>}
        <div className="roi-result">
          <Clock3 size={22} />
          <div><strong>{result ? `${result.hoursRecovered.toFixed(1)} hours` : "Pending"}</strong><span>potential team time recovered</span></div>
        </div>
        <div className="roi-result">
          <ReceiptText size={22} />
          <div><strong>{result ? money(result.valueRecovered) : "Pending"}</strong><span>potential capacity value recovered</span></div>
        </div>
        <div className="roi-result">
          <Calculator size={22} />
          <div><strong>{result ? `${result.approvalDaysRecovered.toFixed(1)} milestone-days` : "Pending"}</strong><span>potential approval delay removed</span></div>
        </div>
        <p className="roi-caveat">Validate these assumptions during the beta using actual timestamps and team estimates. Do not use the result as a public ROI claim until a customer approves the underlying data and comparison.</p>
      </div>
    </section>
  );
}
