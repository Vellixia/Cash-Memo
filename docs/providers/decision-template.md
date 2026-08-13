# Provider decision record

Schema: `cashmemo.provider-decision.v1`. One record per exact provider operation. Approval never
transfers across endpoint, model, project, or operation.

## Identity and purpose

- Provider/legal entity:
- Exact operation:
- Endpoint and model/API snapshot:
- Production project identity protected reference:

## Data boundary

- Data sent, by approved schema class:
- Data explicitly excluded:
- Minimization proof:
- Unrelated account/journal history excluded: yes/no

## Privacy and lifecycle

- Training use control and administrative evidence:
- Retention mode and maximum:
- Deletion method and maximum:
- Storage residency:
- Processing residency guarantee or limitation:

## Reliability

- Timeout/retry/rate-limit behavior:
- Invalid output behavior:
- Outage/failure behavior:
- Manual or disabled fallback:
- Replacement project-owned port:

## Governance

- Named DPA/legal owner:
- Protected evidence reference and SHA-256:
- Evidence issue time:
- Evidence expiry/review time:
- Approval status:

Missing, expired, revoked, or endpoint-mismatched evidence blocks production use. `store:false`,
public documentation, personal credentials, or sandbox behavior alone cannot prove administrative
approval.
