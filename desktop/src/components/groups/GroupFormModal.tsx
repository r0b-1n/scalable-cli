import { useEffect, useState } from "react";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Modal from "../ui/Modal";
import { useI18n } from "../../i18n";
import type { PortfolioGroup } from "../../api/types";

export interface GroupFormValues {
  name: string;
  description?: string;
  clearDescription?: boolean;
}

interface GroupFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing an existing group; absent for create. */
  group: PortfolioGroup | null;
  onSubmit: (values: GroupFormValues) => Promise<void> | void;
  busy: boolean;
}

/**
 * Create/edit form for a portfolio group. `updatePortfolioGroup` requires at
 * least one of name/description/clearDescription — this always sends `name`,
 * which trivially satisfies that on every save.
 */
export default function GroupFormModal({ open, onClose, group, onSubmit, busy }: GroupFormModalProps) {
  const { t } = useI18n();
  const isEdit = group != null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      setName(group?.name ?? "");
      setDescription(group?.description ?? "");
    }
  }, [open, group]);

  const originalDescription = group?.description ?? "";
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const willClear = isEdit && originalDescription !== "" && trimmedDescription === "";

  const handleSubmit = async () => {
    if (!trimmedName) return;
    await onSubmit({
      name: trimmedName,
      description: !willClear && trimmedDescription !== "" ? trimmedDescription : undefined,
      clearDescription: willClear || undefined,
    });
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={isEdit ? t.groups.edit : t.groups.create} maxWidth="max-w-md">
      <div className="space-y-4">
        <Input
          label={t.groups.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-text-secondary">{t.groups.description}</label>
            {isEdit && originalDescription !== "" && description !== "" && (
              <button
                type="button"
                onClick={() => setDescription("")}
                className="cursor-pointer text-2xs font-medium text-text-tertiary hover:text-negative"
              >
                {t.groups.clearDescription}
              </button>
            )}
          </div>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t.common.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={busy || !trimmedName}>
            {isEdit ? t.groups.edit : t.groups.create}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
