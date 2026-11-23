import { ConfirmDialog } from './ConfirmDialog';

export function LeaveDialog({ changes, save = false, onStay, onLeave }: {
  changes: number;
  save?: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  return (
    <ConfirmDialog
      title={save ? 'Discard Setup changes?' : 'Leave without saving?'}
      description={<>You have {changes} unsaved {changes === 1 ? 'change' : 'changes'} in Setup.{save && ' Saving General settings drops them.'}</>}
      confirmLabel={save ? 'Discard Setup changes' : 'Leave without saving'}
      cancelLabel="Stay"
      onConfirm={onLeave}
      onCancel={onStay}
    />
  );
}
