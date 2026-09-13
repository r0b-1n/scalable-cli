import { useI18n } from "../../i18n";
import Badge from "../ui/Badge";
import CliCommand from "../ui/CliCommand";
import EmptyState from "../ui/EmptyState";
import { Layers } from "lucide-react";
import { Field, BoolIcon, CodeList } from "./shared";
import type { WorkflowEntry } from "./shared";

/**
 * The two-phase workflows `sc capabilities --json` declares
 * (`broker.trade.buy`, `broker.trade.sell`, `broker.savings-plans.add`).
 * Each one's `phase_1_presentation_requirement` is the compliance rule a
 * trade or savings-plan preview enforces — `rule_id`, `section_order` and
 * `required_leaf_paths` are exactly what makes that disclosure auditable:
 * this is where a reader can check the app renders every required section.
 */
export default function WorkflowsPanel({ workflows }: { workflows: Record<string, unknown> }) {
  const { t } = useI18n();
  const entries = Object.entries(workflows ?? {});

  if (entries.length === 0) {
    return <EmptyState icon={<Layers size={20} />} title={t.cli.workflows} description="—" />;
  }

  return (
    <div className="space-y-5">
      {entries.map(([key, raw]) => {
        const workflow = raw as WorkflowEntry;
        const req = workflow.phase_1_presentation_requirement;
        const templates = [
          workflow.phase_1_command_template_json,
          workflow.phase_2_command_template_json,
        ].filter((c): c is string => Boolean(c));

        return (
          <div key={key} className="rounded-2xl border border-border bg-bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <code className="text-sm font-semibold text-text-primary">{key}</code>
              {workflow.mode && <Badge variant="accent">{workflow.mode}</Badge>}
            </div>

            {templates.length > 0 && (
              <CliCommand commands={templates} variant="block" className="mb-4" />
            )}

            <div className="space-y-3">
              {workflow.phase_1 && (
                <div>
                  <code className="text-2xs text-text-tertiary">phase_1</code>
                  <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                    {workflow.phase_1}
                  </p>
                </div>
              )}
              {workflow.phase_2 && (
                <div>
                  <code className="text-2xs text-text-tertiary">phase_2</code>
                  <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                    {workflow.phase_2}
                  </p>
                </div>
              )}
            </div>

            {req && (
              <div className="mt-4 divide-y divide-border border-t border-border pt-1">
                <Field name="rule_id">
                  <span className="font-mono text-xs text-text-primary">{req.rule_id ?? "—"}</span>
                </Field>
                <Field name="format">
                  <span className="font-mono text-2xs text-text-secondary">{req.format ?? "—"}</span>
                </Field>
                <Field name="section_order">
                  <ol className="flex flex-wrap items-center justify-end gap-1.5">
                    {(req.section_order ?? []).map((section, i) => (
                      <li
                        key={section}
                        className="flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 font-mono text-2xs text-text-secondary"
                      >
                        <span className="text-text-tertiary">{i + 1}</span>
                        {section}
                      </li>
                    ))}
                  </ol>
                </Field>
                <Field name="required_leaf_paths" className="items-start">
                  <CodeList items={req.required_leaf_paths ?? []} />
                </Field>
                <Field name="must_present_all_information">
                  <BoolIcon value={req.must_present_all_information} />
                </Field>
                <Field name="requires_explicit_user_confirmation_between_phases">
                  <BoolIcon value={req.requires_explicit_user_confirmation_between_phases} />
                </Field>
                <Field name="forbid_automatic_phase_2_execution">
                  <BoolIcon value={req.forbid_automatic_phase_2_execution} />
                </Field>
                <Field name="confirmation_must_be_separate_step">
                  <BoolIcon value={req.confirmation_must_be_separate_step} />
                </Field>
                <Field name="preserve_exact_values">
                  <BoolIcon value={req.preserve_exact_values} />
                </Field>
                <Field name="display_null_as_literal">
                  <BoolIcon value={req.display_null_as_literal} />
                </Field>
                <Field name="raw_json_only_on_user_request">
                  <BoolIcon value={req.raw_json_only_on_user_request} />
                </Field>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
