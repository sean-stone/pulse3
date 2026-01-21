import { getEl } from "../dom";

let confirmResolve: ((result: boolean) => void) | null = null;
let confirmDialogHome: HTMLElement | null = null;

const attachConfirmDialogTo = (hostId?: string) => {
  const dialog = getEl("confirm-dialog");
  if (!confirmDialogHome) {
    confirmDialogHome = dialog.parentElement;
  }
  const host = hostId ? document.getElementById(hostId) : null;
  if (host) {
    host.appendChild(dialog);
    return;
  }
  if (confirmDialogHome) {
    confirmDialogHome.appendChild(dialog);
  }
};

const openConfirmDialog = (options: {
  message: string;
  heading?: string;
  confirmText?: string;
  cancelText?: string;
  confirmKind?: string;
  hostId?: string;
}) => {
  const dialog = getEl("confirm-dialog") as any;
  const message = getEl("confirm-message");
  const confirmButton = getEl("confirm-accept");
  const cancelButton = getEl("confirm-cancel");
  const confirmKind = options.confirmKind || "brand";

  message.textContent = options.message;
  dialog.heading = options.heading || "Confirm";
  confirmButton.textContent = options.confirmText || "Confirm";
  cancelButton.textContent = options.cancelText || "Cancel";
  confirmButton.setAttribute("kind", confirmKind);

  if (confirmResolve) {
    confirmResolve(false);
    confirmResolve = null;
  }

  attachConfirmDialogTo(options.hostId);
  dialog.open = true;
  return new Promise<boolean>((resolve) => {
    confirmResolve = resolve;
  });
};

const closeConfirmDialog = (result: boolean) => {
  if (!confirmResolve) return;
  confirmResolve(result);
  confirmResolve = null;
  const dialog = getEl("confirm-dialog") as any;
  dialog.open = false;
  attachConfirmDialogTo();
};

const bindConfirmDialogListeners = () => {
  getEl("confirm-cancel").addEventListener("click", () => closeConfirmDialog(false));
  getEl("confirm-accept").addEventListener("click", () => closeConfirmDialog(true));
  const confirmDialog = getEl("confirm-dialog");
  confirmDialog.addEventListener("calciteDialogClose", () => closeConfirmDialog(false));
};

export { bindConfirmDialogListeners, closeConfirmDialog, openConfirmDialog };
