import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, Plus } from "lucide-react";
import { api } from "../../api/client";
import { useAppStore } from "../../store/appStore";
import { useToast } from "../ui/Toast";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import Select from "../ui/Select";
import EmptyState from "../ui/EmptyState";
import ConfirmDialog from "../ui/ConfirmDialog";
import CliCommand from "../ui/CliCommand";
import { SkeletonLines } from "../ui/Skeleton";
import { formatCurrency } from "../../lib/format";
import { renderCliCommand } from "../../lib/cliLog";
import { enumLabel, useI18n } from "../../i18n";
import type { Holding, PortfolioGroup, PortfolioGroupItem } from "../../api/types";
import GroupCard from "./GroupCard";
import GroupFormModal, { type GroupFormValues } from "./GroupFormModal";

export default function PortfolioGroups() {
  const { activePortfolioId, refreshToken } = useAppStore();
  const { t } = useI18n();
  const { push } = useToast();

  const [groups, setGroups] = useState<PortfolioGroup[]>([]);
  const [ungrouped, setUngrouped] = useState<PortfolioGroupItem[]>([]);
  const [maxReached, setMaxReached] = useState(false);
  const [offerAllowsAdditional, setOfferAllowsAdditional] = useState(false);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PortfolioGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PortfolioGroup | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [movingIsin, setMovingIsin] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [groupsRes, holdingsRes] = await Promise.allSettled([
        api.getPortfolioGroups(activePortfolioId || undefined),
        api.getHoldings({ portfolioId: activePortfolioId || undefined }),
      ]);
      if (groupsRes.status === "fulfilled") {
        const r = groupsRes.value.result;
        setGroups(r.portfolio_groups ?? []);
        setUngrouped(r.ungrouped_items ?? []);
        setMaxReached(r.max_groups_per_portfolio_reached);
        setOfferAllowsAdditional(r.offer_allows_additional_group);
      } else {
        setError(
          groupsRes.reason instanceof Error ? groupsRes.reason.message : t.common.loadFailed
        );
      }
      if (holdingsRes.status === "fulfilled") {
        setHoldings(holdingsRes.value.result.items ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [activePortfolioId, t.common.loadFailed]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const holdingsByIsin = useMemo(() => {
    const map = new Map<string, Holding>();
    for (const h of holdings) map.set(h.isin, h);
    return map;
  }, [holdings]);

  const cliCommand = renderCliCommand("get_portfolio_groups", {
    portfolioId: activePortfolioId || undefined,
  });

  const createDisabled = maxReached && !offerAllowsAdditional;

  const notifyError = (err: unknown) =>
    push({
      tone: "error",
      title: t.common.loadFailed,
      description: err instanceof Error ? err.message : undefined,
    });

  const handleCreateOrUpdate = async (values: GroupFormValues) => {
    setSaving(true);
    try {
      if (editingGroup) {
        await api.updatePortfolioGroup({
          groupId: editingGroup.group_id,
          name: values.name,
          description: values.description,
          clearDescription: values.clearDescription,
          portfolioId: activePortfolioId || undefined,
        });
        push({ tone: "success", title: t.groups.updated });
      } else {
        await api.createPortfolioGroup({
          name: values.name,
          description: values.description,
          portfolioId: activePortfolioId || undefined,
        });
        push({ tone: "success", title: t.groups.created });
      }
      setFormOpen(false);
      setEditingGroup(null);
      load();
    } catch (err) {
      notifyError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deletePortfolioGroup(deleteTarget.group_id, activePortfolioId || undefined);
      push({ tone: "success", title: t.groups.deleted });
      setDeleteTarget(null);
      load();
    } catch (err) {
      notifyError(err);
    } finally {
      setDeleting(false);
    }
  };

  // Reassigning always uses the single-item form of the repeatable --isin
  // flag; assigning to a new group moves the holding out of any group it was
  // already in, so a "move" is just an assign (or, to leave every group, an
  // unassign from its current one).
  const handleMoveItem = async (fromGroupId: string | null, isin: string, targetGroupId: string | null) => {
    setMovingIsin(isin);
    try {
      if (targetGroupId) {
        await api.assignToGroup({
          groupId: targetGroupId,
          isin: [isin],
          portfolioId: activePortfolioId || undefined,
        });
        push({ tone: "success", title: t.groups.assigned });
      } else if (fromGroupId) {
        await api.unassignFromGroup({
          groupId: fromGroupId,
          isin: [isin],
          portfolioId: activePortfolioId || undefined,
        });
        push({ tone: "success", title: t.groups.unassigned });
      }
      load();
    } catch (err) {
      notifyError(err);
    } finally {
      setMovingIsin(null);
    }
  };

  if (error && groups.length === 0 && ungrouped.length === 0) {
    return (
      <div className="space-y-8">
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.groups.title}</h1>
        <div className="space-y-4 py-16 text-center">
          <p className="mx-auto max-w-md whitespace-pre-line text-sm text-text-secondary">{error}</p>
          <Button variant="secondary" onClick={load}>
            {t.common.retry}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">{t.groups.title}</h1>
          <p className="mt-1 text-sm text-text-secondary">{t.groups.subtitle}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button
            size="sm"
            disabled={createDisabled}
            title={createDisabled ? t.groups.limitReached : undefined}
            onClick={() => {
              setEditingGroup(null);
              setFormOpen(true);
            }}
          >
            <Plus size={14} className="mr-1.5" />
            {t.groups.create}
          </Button>
          {createDisabled && <Badge variant="warning">{t.groups.limitReached}</Badge>}
        </div>
      </div>

      {loading ? (
        <SkeletonLines rows={6} />
      ) : groups.length === 0 && ungrouped.length === 0 ? (
        <EmptyState icon={<Layers size={20} />} title={t.groups.empty} description={t.groups.emptyHint} />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <GroupCard
              key={group.group_id}
              group={group}
              otherGroups={groups.filter((g) => g.group_id !== group.group_id)}
              holdingsByIsin={holdingsByIsin}
              movingIsin={movingIsin}
              onEdit={() => {
                setEditingGroup(group);
                setFormOpen(true);
              }}
              onDelete={() => setDeleteTarget(group)}
              onMoveItem={(isin, target) => handleMoveItem(group.group_id, isin, target)}
            />
          ))}

          {ungrouped.length > 0 && (
            <div className="rounded-2xl border border-border bg-bg-card p-5">
              <p className="mb-3 text-2xs font-medium uppercase tracking-wide text-text-tertiary">
                {t.groups.ungrouped} · {ungrouped.length}
              </p>
              <div className="divide-y divide-border">
                {ungrouped.map((item) => {
                  const h = holdingsByIsin.get(item.isin);
                  return (
                    <div
                      key={item.isin}
                      className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge>{enumLabel(t.common.securityTypes, item.security_type)}</Badge>
                        <div className="min-w-0">
                          <p className="truncate text-sm text-text-primary">{item.name || item.isin}</p>
                          <p className="text-2xs text-text-tertiary">{item.isin}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {h && (
                          <span className="text-sm tabular-nums text-text-secondary">
                            {formatCurrency(h.valuation ?? 0, h.valuation_currency || "EUR")}
                          </span>
                        )}
                        <Select
                          aria-label={t.groups.assignTo}
                          value=""
                          disabled={movingIsin === item.isin || groups.length === 0}
                          placeholder={t.groups.assignTo}
                          onChange={(e) => {
                            const target = e.target.value;
                            if (target) handleMoveItem(null, item.isin, target);
                          }}
                          options={groups.map((g) => ({ value: g.group_id, label: g.name }))}
                          className="h-8 w-40 text-xs"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <CliCommand commands={cliCommand} variant="block" />

      <GroupFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingGroup(null);
        }}
        group={editingGroup}
        onSubmit={handleCreateOrUpdate}
        busy={saving}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t.groups.delete}
        description={
          deleteTarget && (
            <div className="space-y-1">
              <p>{t.groups.deleteConfirm(deleteTarget.name)}</p>
              <p className="text-text-tertiary">{t.groups.deleteConfirmBody}</p>
            </div>
          )
        }
        confirmLabel={t.groups.delete}
        cancelLabel={t.common.cancel}
        tone="danger"
        busy={deleting}
      />
    </div>
  );
}
