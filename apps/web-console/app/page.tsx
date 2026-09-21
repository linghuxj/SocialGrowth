'use client';
import { OperationsProvider } from '@/lib/operations-context';
import { OperationsConsole } from '@/components/operations/console';
export default function ConsolePage() {
  return (
    <OperationsProvider>
      <OperationsConsole />
    </OperationsProvider>
  );
}
