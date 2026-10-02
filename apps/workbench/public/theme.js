try {
  document.documentElement.dataset.theme = localStorage.getItem("aftershock-theme") === "light" ? "light" : "dark";
} catch {
  // The default mode still works when storage is unavailable.
}
