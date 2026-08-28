import type { MonthlySummaryContract } from "../../generated/api/model/monthlySummaryContract";
import { Amount } from "../../components/money/amount";
import { CurrencyGroup } from "../../components/money/currency-group";
import { Progress } from "../../components/ui/progress";
import { boundedPercentage } from "../../components/money/exact-decimal";

export function MonthlySummary({ summary }: { summary: MonthlySummaryContract }) {
  if (summary.currencies.length === 0) {
    return (
      <div className="empty-state">
        <h2>No activity this month</h2>
        <p>Confirmed transactions will appear here.</p>
      </div>
    );
  }
  return (
    <div className="currency-grid">
      {summary.currencies.map((group) => (
        <CurrencyGroup key={group.currency} currency={group.currency}>
          <dl className="summary-grid">
            <div>
              <dt>Income</dt>
              <dd>
                <Amount currency={group.currency} value={group.income} direction="income" />
              </dd>
            </div>
            <div>
              <dt>Expense</dt>
              <dd>
                <Amount currency={group.currency} value={group.expense} direction="expense" />
              </dd>
            </div>
            <div>
              <dt>Net</dt>
              <dd>
                <Amount currency={group.currency} value={group.net} />
              </dd>
            </div>
          </dl>
          {group.expense_categories.length > 0 ? (
            <div>
              <h3>Expense categories</h3>
              <ul className="plain-list category-list">
                {group.expense_categories.map((category) => (
                  <li key={category.category_id} className="category-row">
                    <div className="category-row-heading">
                      <span>{category.name}</span>
                      <span>
                        <Amount
                          currency={group.currency}
                          value={category.expense}
                          direction="expense"
                        />
                      </span>
                    </div>
                    <Progress
                      value={boundedPercentage(category.share_percent)}
                      aria-label={`${category.name} expense share`}
                      aria-valuetext={`${category.share_percent}%`}
                    >
                      <span className="progress-label">{category.name}</span>
                      <span className="progress-value">{category.share_percent}%</span>
                    </Progress>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted">No expenses in this currency.</p>
          )}
        </CurrencyGroup>
      ))}
    </div>
  );
}
