(function () {
  try {
    var theme = localStorage.getItem("fixture-ocr-market-builder-theme-v1");
    if (theme === "dark" || theme === "light") {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      var themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) {
        themeMeta.setAttribute("content", theme === "dark" ? "#243140" : "#f4f9fc");
      }
    }
  } catch {}
})();
