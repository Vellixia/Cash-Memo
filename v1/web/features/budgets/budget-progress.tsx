import type { BudgetProgressContract } from "../../generated/api/model/budgetProgressContract";
import { Amount } from "../../components/money/amount";

export function BudgetProgress({ budget, categoryName }: { budget: BudgetProgressContract; categoryName: string }) {
  const overBudget = budget.remaining.trim().startsWith("-");
  const meterValue = Math.max(0, Math.min(100, Number.parseFloat(budget.progress) || 0));
  const valueText = `${budget.progress}% used${overBudget ? " — over budget" : ""}`;
  return <article className={`budget-card ${overBudget ? "is-over-budget" : ""}`}><h2>{categoryName}</h2><p className="status-label">{overBudget ? "Over budget" : "Within budget"}</p><p>{budget.progress}% used</p><progress aria-label={`${categoryName} budget progress`} aria-valuetext={valueText} max={100} value={meterValue}>{valueText}</progress><dl className="budget-values"><div><dt>Budgeted</dt><dd><Amount currency={budget.currency} value={budget.budgeted} /></dd></div><div><dt>Spent</dt><dd><Amount currency={budget.currency} value={budget.spent} /></dd></div><div><dt>Remaining</dt><dd><Amount currency={budget.currency} value={budget.remaining} /></dd></div></dl></article>;
}
