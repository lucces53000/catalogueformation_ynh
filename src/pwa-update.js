const isLocalEmulatorHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);

if (isLocalEmulatorHost && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch((error) => console.warn("Impossible de désactiver le service worker local :", error));
} else if ("serviceWorker" in navigator && window.isSecureContext) {
  let hasController = Boolean(navigator.serviceWorker.controller);
  let isReloading = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hasController) {
      hasController = true;
      return;
    }
    if (isReloading) return;
    isReloading = true;
    window.location.reload();
  });

  const checkForUpdate = (registration) => {
    registration.update().catch((error) => {
      console.warn("Échec de la vérification des mises à jour PWA :", error);
    });
  };

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js", {
        updateViaCache: "none"
      });
      checkForUpdate(registration);
      window.setInterval(() => checkForUpdate(registration), 5 * 60 * 1000);
      window.addEventListener("focus", () => checkForUpdate(registration));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate(registration);
      });
    } catch (error) {
      console.error("Échec de l’enregistrement du service worker :", error);
    }
  });
}
