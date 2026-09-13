import Card, { CardTitle } from "./Card";
import type { PresentationSection } from "../../api/types";
import { formatDisclosureValue } from "../../lib/disclosure";

/**
 * One disclosure section, rendered in full: title plus every field, values
 * shown verbatim. Reused by the trade ticket's mandated phase-1
 * disclosure, the savings-plan disclosure and the cost what-if comparison,
 * so a field is never re-labelled or re-formatted differently in one place
 * than in another.
 */
export default function DisclosureSection({
  section,
  displayNullAsLiteral,
  className,
}: {
  section: PresentationSection;
  displayNullAsLiteral?: boolean;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardTitle className="mb-2.5">{section.title}</CardTitle>
      <div className="divide-y divide-border">
        {section.fields.map((field) => (
          <div
            key={field.path}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2"
          >
            <span className="text-sm text-text-secondary">{field.label}</span>
            <span className="text-right text-sm font-medium tabular-nums text-text-primary">
              {formatDisclosureValue(field.value, displayNullAsLiteral)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
