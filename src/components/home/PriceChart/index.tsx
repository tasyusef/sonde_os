"use client";

import { useEffect, useRef, useState, memo } from "react";

/**
 * XRP Price Chart — powered by TradingView's Advanced Chart widget.
 * Themed to match Sonde's design system (dark/light, brand colors).
 */
function PriceChartInner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDark, setIsDark] = useState(true);

  // Detect theme — lazy initializer can't access DOM (SSR), so we
  // read the initial value in useEffect and watch for changes via
  // MutationObserver on the <html> class attribute.
  useEffect(() => {
    const html = document.documentElement;
    const update = () => setIsDark(!html.classList.contains("light"));

    // Read the current theme immediately on mount.
    update();

    // Watch for future theme toggles.
    const observer = new MutationObserver(update);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.type = "text/javascript";
    script.textContent = JSON.stringify({
      autosize: true,
      symbol: "BITSTAMP:XRPUSD",
      interval: "D",
      timezone: "Etc/UTC",
      theme: isDark ? "dark" : "light",
      style: "3",
      locale: "en",
      allow_symbol_change: false,
      hide_top_toolbar: false,
      hide_legend: true,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
      backgroundColor: isDark ? "#12151A" : "#FFFFFF",
      gridColor: isDark ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 0, 0, 0.04)",
      withdateranges: true,
      details: false,
      hotlist: false,
      show_popup_button: false,
      overrides: {
        // Area chart line + fill
        "mainSeriesProperties.areaStyle.color1": isDark ? "rgba(232, 133, 108, 0.20)" : "rgba(181, 89, 58, 0.15)",
        "mainSeriesProperties.areaStyle.color2": "rgba(232, 133, 108, 0)",
        "mainSeriesProperties.areaStyle.linecolor": isDark ? "#E8856C" : "#B5593A",
        "mainSeriesProperties.areaStyle.linewidth": 2,
        // Candlestick colors (if user switches to candles)
        "mainSeriesProperties.candleStyle.upColor": isDark ? "#5BAE7C" : "#3A8F5C",
        "mainSeriesProperties.candleStyle.downColor": isDark ? "#EF6461" : "#C44442",
        "mainSeriesProperties.candleStyle.borderUpColor": isDark ? "#5BAE7C" : "#3A8F5C",
        "mainSeriesProperties.candleStyle.borderDownColor": isDark ? "#EF6461" : "#C44442",
        "mainSeriesProperties.candleStyle.wickUpColor": isDark ? "#5BAE7C" : "#3A8F5C",
        "mainSeriesProperties.candleStyle.wickDownColor": isDark ? "#EF6461" : "#C44442",
        // Volume bars
        "volume.volume.color.0": isDark ? "rgba(239, 100, 97, 0.3)" : "rgba(196, 68, 66, 0.25)",
        "volume.volume.color.1": isDark ? "rgba(91, 174, 124, 0.3)" : "rgba(58, 143, 92, 0.25)",
        // Pane separator
        "paneProperties.separatorColor": isDark ? "#282C35" : "#E0E4E8",
      },
    });

    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [isDark]);

  return (
    // Fixed height (`h-[480px]`) — TradingView's `autosize: true`
    // widget fills the parent. Pre-2026-05-10 this used `h-full
    // min-h-[400px]` which worked when the chart sat in a
    // [320px / 1fr] grid against the old multi-card NetworkStatsBar
    // (parent grid row gave it a definite height). After the
    // Network Overview restructure put PriceChart in a flat
    // full-width row, `h-full` lost its constraint and the widget
    // expanded indefinitely, dumping a giant blank rectangle below
    // the chart on mobile. A fixed height is the right call here —
    // the chart looks the same whatever the surrounding layout does.
    <div className="h-[480px] overflow-hidden rounded-2xl shadow-card bg-surface">
      <div
        ref={containerRef}
        className="tradingview-widget-container"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

const PriceChart = memo(PriceChartInner);
export default PriceChart;
