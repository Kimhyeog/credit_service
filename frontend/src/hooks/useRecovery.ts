"use client";

import { useEffect, useState } from "react";
import {
  RecoveryService,
  type RecoveryResult,
} from "@/services/recovery/RecoveryService";
import { WALManager } from "@/services/recovery/WALManager";

export function useRecovery() {
  const [results, setResults] = useState<RecoveryResult[]>([]);
  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    const service = new RecoveryService();

    setIsRecovering(true);
    service
      .recoverAll()
      .then(setResults)
      .catch(console.error)
      .finally(() => setIsRecovering(false));
  }, []);

  const needsManualCount = results.filter(
    (r) => r.action === "needs_manual"
  ).length;

  const recoveredCount = results.filter(
    (r) => r.action === "confirmed" || r.action === "cleaned"
  ).length;

  const dismiss = () => {
    // "수동 확인 필요" 엔트리도 WAL에서 제거하여 재표시 방지
    const wal = new WALManager();
    results
      .filter((r) => r.action === "needs_manual")
      .forEach((r) => wal.remove(r.walId));
    setResults([]);
  };

  return {
    results,
    isRecovering,
    needsManualCount,
    recoveredCount,
    dismiss,
  };
}
