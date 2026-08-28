import type { BudgetProgressContract } from "../../generated/api/model/budgetProgressContract";
import { MoneyAmount } from "../../components/money/amount";
import { boundedPercentage, splitExactDecimal } from "../../components/money/exact-decimal";
import { Progress } from "../../components/ui/progress";

function isStrictlyNegative(value: string): boolean {
  const parts = splitExactDecimal(value);
  if (parts?.sign !== "-") return false;
  return parts.whole !== "0" || /[1-9]/.test(parts.fraction);
}

export function BudgetProgress({
  budget,
  categoryName,
}: {
  budget: BudgetProgressContract;
  categoryName: string;
}) {
  const overBudget = isStrictlyNegative(budget.remaining);
  const meterValue = boundedPercentage(budget.progress);
  const valueText = `${budget.progress}% used${overBudget ? " — over budget" : ""}`;
  return (
    <article className={`budget-card ${overBudget ? "is-over-budget" : ""}`}>
      <h2>{categoryName}</h2>
      <p className="status-label">
        {overBudget ? (
          <>
            <span aria-hidden="true">⚠ </span>Over budget
          </>
        ) : (
          "Within budget"
        )}
      </p>
      <p>{budget.progress}% used</p>
      <Progress
        value={meterValue}
        aria-label={`${categoryName} budget progress`}
        aria-valuetext={valueText}
      />
      <dl className="budget-values">
        <div>
          <dt>Budgeted</dt>
          <dd>
            <MoneyAmount currency={budget.currency} value={budget.budgeted} />
          </dd>
        </div>
        <div>
          <dt>Spent</dt>
          <dd>
            <MoneyAmount currency={budget.currency} value={budget.spent} />
          </dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd>
            <MoneyAmount currency={budget.currency} value={budget.remaining} />
          </dd>
        </div>
      </dl>
    </article>
  );
}
