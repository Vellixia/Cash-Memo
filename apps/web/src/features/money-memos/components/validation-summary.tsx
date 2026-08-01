type Props = Readonly<{ fields: string[] }>;

const labels: Record<string, string> = {
  type: "Choose income or expense.",
  amount:
    "Enter a positive amount within the supported currency precision and limit.",
  currency: "Choose a supported currency.",
  occurrence: "Choose a valid occurrence within ten years.",
  categoryId: "Choose an active Category.",
  moneySpaceId: "Choose an active Money Space.",
  note: "Keep the note at 1,000 characters or fewer.",
  plannedStatus: "Choose planned or unplanned.",
  purpose: "Choose a purpose.",
};

export function ValidationSummary({ fields }: Props) {
  if (fields.length === 0) return null;
  return (
    <section
      role="alert"
      aria-labelledby="validation-title"
      className="rounded-xl border p-4"
    >
      <h2 id="validation-title" className="font-semibold">
        Correct these fields
      </h2>
      <ul className="mt-2 list-disc pl-5">
        {fields.map((field) => (
          <li key={field}>{labels[field] ?? "Correct this field."}</li>
        ))}
      </ul>
    </section>
  );
}
