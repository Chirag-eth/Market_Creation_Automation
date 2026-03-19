(function () {
  try {
    var theme = localStorage.getItem("fixture-ocr-market-builder-theme-v1");
    if (theme === "dark" || theme === "light") {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    }
  } catch {}
})();
