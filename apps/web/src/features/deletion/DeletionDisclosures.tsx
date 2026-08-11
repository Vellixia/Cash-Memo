export function DeletionDisclosures() {
  return (
    <section aria-labelledby="deletion-disclosures-title" data-testid="deletion-disclosures">
      <h2 id="deletion-disclosures-title">How deletion works</h2>
      <dl>
        <dt>Recently Deleted</dt>
        <dd>
          Deleted Money Memos remain recoverable for 30 days unless you request immediate permanent
          purge. They stay outside history, search, and financial reports.
        </dd>
        <dt>Immediate Money Memo purge</dt>
        <dd>
          Purge makes the memo inaccessible immediately. Live content is removed only after durable
          deletion protection is recorded; failures remain inaccessible and retryable.
        </dd>
        <dt>Account deletion grace</dt>
        <dd>
          Account deletion has a seven-day grace period. Journal access is suspended, but deletion
          can be canceled before irreversible purge begins.
        </dd>
        <dt>Irreversible live purge</dt>
        <dd>
          Cancellation is unavailable after live purge begins. Live-data progress and failures are
          reported separately.
        </dd>
        <dt>Provider deletion</dt>
        <dd>
          Approved providers may report deletion as not required, pending, completed, or needing
          escalation. Pending provider work is never presented as completed.
        </dd>
        <dt>Backup aging</dt>
        <dd>
          Encrypted backup recovery windows can outlast live purge. Backup copies age out under
          controlled retention and later restore verification; they are not manually edited in
          place.
        </dd>
        <dt>Required retained records</dt>
        <dd>
          Limited content-free security or legal records may remain for their defined period. They
          do not contain journal amounts, notes, labels, or exported content.
        </dd>
      </dl>
    </section>
  );
}
