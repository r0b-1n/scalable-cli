import { useNavigate } from "react-router-dom";
import Button from "../ui/Button";
import Card from "../ui/Card";
import Modal from "../ui/Modal";
import Select from "../ui/Select";
import CliCommand from "../ui/CliCommand";
import { renderCliCommand } from "../../lib/cliLog";
import { useI18n } from "../../i18n";
import type { PortfolioGroup } from "../../api/types";

interface BulkAssignModalProps {
  open: boolean;
  onClose: () => void;
  selectedCount: number;
  isins: string[];
  portfolioId?: string;
  groups: PortfolioGroup[];
  groupId: string;
  onGroupIdChange: (id: string) => void;
  onConfirm: () => void;
  busy: boolean;
}

/**
 * The composite "assign selection to group" action from the holdings table.
 * `assignToGroup` takes a repeatable `--isin`; this always sends every
 * selected ISIN in one call.
 */
export default function BulkAssignModal({
  open,
  onClose,
  selectedCount,
  isins,
  portfolioId,
  groups,
  groupId,
  onGroupIdChange,
  onConfirm,
  busy,
}: BulkAssignModalProps) {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <Modal isOpen={open} onClose={onClose} title={t.groups.assignTo} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          {t.groups.selectItems} · {selectedCount}
        </p>
        {groups.length === 0 ? (
          <Card variant="flat" padding={false} className="rounded-lg border border-border bg-bg-inset p-4">
            <p className="text-sm text-text-secondary">{t.groups.empty}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => navigate("/groups")}>
              {t.groups.create}
            </Button>
          </Card>
        ) : (
          <>
            <Select
              label={t.groups.name}
              value={groupId}
              onChange={(e) => onGroupIdChange(e.target.value)}
              placeholder={t.groups.assignTo}
              options={groups.map((g) => ({ value: g.group_id, label: g.name }))}
            />
            {groupId && (
              <CliCommand
                commands={renderCliCommand("assign_to_group", { groupId, isin: isins, portfolioId })}
              />
            )}
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button onClick={onConfirm} disabled={busy || !groupId || groups.length === 0}>
            {t.groups.assign}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
