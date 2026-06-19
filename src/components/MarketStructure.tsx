import React, { useRef, useEffect, useState } from 'react';
import { useTerminalStore } from '../store';
import { Candlestick } from '../types';

interface StructuralSwing {
  index: number;
  price: number;
  type: 'BoS' | 'CHoCH';
  label: string;
}

function formatVolume(val: number): string {
  if (val >= 1000000) return `${(val / 1000000).toFixed(2)}M`;
  if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
  return val.toString();
}

export function MarketStructure() {
  const store = useTerminalStore();
  const spotCandles = store.duckdbCandles['NIFTY_SPOT'] || [];

  const htfCanvasRef = useRef<HTMLCanvasElement>(null);
  const ltfCanvasRef = useRef<HTMLCanvasElement>(null);
  const htfVolumeCanvasRef = useRef<HTMLCanvasElement>(null);
  const ltfVolumeCanvasRef = useRef<HTMLCanvasElement>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [htfHoverPrice, setHtfHoverPrice] = useState<number | null>(null);
  const [ltfHoverPrice, setLtfHoverPrice] = useState<number | null>(null);

  // Synced crosshairs observer
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Generate Simulated HTF Candles (1-Hour)
  const htfCandles: Candlestick[] = [];
  const startHtfTime = Date.now() - 24 * 3600 * 1000; // 24 hours back
  let runningSpot = 23300;
  for (let i = 0; i < 24; i++) {
    const o = runningSpot;
    const c = runningSpot + (Math.random() - 0.45) * 40;
    const h = Math.max(o, c) + Math.random() * 10;
    const l = Math.min(o, c) - Math.random() * 10;
    runningSpot = c;
    htfCandles.push({
      time: startHtfTime + i * 3600 * 1000,
      open: Number(o.toFixed(1)),
      high: Number(h.toFixed(1)),
      low: Number(l.toFixed(1)),
      close: Number(c.toFixed(1)),
      volume: Math.round(400000 + Math.random() * 200000),
      oi: 0
    });
  }

  // Pre-configured structural breaks for HTF swing highlights representation
  const htfSwings: StructuralSwing[] = [
    { index: 8, price: 23355, type: 'CHoCH', label: 'CHoCH Breakout' },
    { index: 15, price: 23410, type: 'BoS', label: 'BoS Extension' }
  ];

  // Pre-configured micro breaks on LTF
  const ltfSwings: StructuralSwing[] = [
    { index: 12, price: 23435, type: 'BoS', label: 'Micro BoS' },
    { index: 28, price: 23460, type: 'CHoCH', label: 'Micro CHoCH' }
  ];

  // Draw Higher Timeframe (1-Hour) Panel with Horizontal Volume Profile Sidebar
  useEffect(() => {
    const htfCanvas = htfCanvasRef.current;
    const htfVolumeCanvas = htfVolumeCanvasRef.current;
    if (!htfCanvas || !htfVolumeCanvas || htfCandles.length === 0) return;

    const ctx = htfCanvas.getContext('2d');
    const vpCtx = htfVolumeCanvas.getContext('2d');
    if (!ctx || !vpCtx) return;

    // Dynamically measure actual browser layout dimensions
    const rect = htfCanvas.parentElement!.getBoundingClientRect();
    const w = Math.floor(rect.width) || 300;
    const h = Math.floor(rect.height) || 300;

    const vpRect = htfVolumeCanvas.parentElement!.getBoundingClientRect();
    const vpW = Math.floor(vpRect.width) || 80;
    const vpH = Math.floor(vpRect.height) || 300;

    htfCanvas.width = w;
    htfCanvas.height = h;

    htfVolumeCanvas.width = vpW;
    htfVolumeCanvas.height = vpH;

    ctx.clearRect(0, 0, w, h);
    vpCtx.clearRect(0, 0, vpW, vpH);

    const padL = 15;
    const padR = 45;
    const padT = 30;
    const padB = 25;

    const cW = w - padL - padR;
    const cH = h - padT - padB;

    // Draw grid on Main Chart
    ctx.strokeStyle = '#f4f4f5';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const y = padT + (cH / 6) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
    }

    // Draw grid on Volume Profile Sidebar too
    vpCtx.strokeStyle = '#f4f4f5';
    vpCtx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const y = padT + (cH / 6) * i;
      vpCtx.beginPath();
      vpCtx.moveTo(0, y);
      vpCtx.lineTo(vpW, y);
      vpCtx.stroke();
    }

    const prices = htfCandles.flatMap(c => [c.low, c.high]);
    let minPrice = Math.min(...prices);
    let maxPrice = Math.max(...prices);
    const diff = maxPrice - minPrice || 1;
    minPrice -= diff * 0.05;
    maxPrice += diff * 0.05;
    const inner = maxPrice - minPrice;

    // Calculate Volume Profile Buckets
    const priceBuckets = 16;
    const bucketVol = new Array(priceBuckets).fill(0);
    const bucketBuyVol = new Array(priceBuckets).fill(0);
    const bucketMinPrice = new Array(priceBuckets);
    const bucketMaxPrice = new Array(priceBuckets);

    const binSize = inner / priceBuckets;
    for (let i = 0; i < priceBuckets; i++) {
      bucketMinPrice[i] = minPrice + i * binSize;
      bucketMaxPrice[i] = minPrice + (i + 1) * binSize;
    }

    htfCandles.forEach(c => {
      const isGreen = c.close >= c.open;
      const idx = Math.min(priceBuckets - 1, Math.floor(((c.close - minPrice) / inner) * priceBuckets));
      if (idx >= 0 && idx < priceBuckets) {
        bucketVol[idx] += c.volume;
        if (isGreen) {
          bucketBuyVol[idx] += c.volume * 0.58; // simulated buy ratio
        } else {
          bucketBuyVol[idx] += c.volume * 0.38; // simulated sell ratio
        }
      }
    });

    const maxBucketVol = Math.max(...bucketVol, 1);
    const totalVol = bucketVol.reduce((a, b) => a + b, 0) || 1;

    // Identify Point of Control (POC)
    let pocIdx = 0;
    let maxVol = 0;
    for (let i = 0; i < priceBuckets; i++) {
      if (bucketVol[i] > maxVol) {
        maxVol = bucketVol[i];
        pocIdx = i;
      }
    }

    // Identify Value Area (contributing to 70% of volume)
    const inValueArea = new Set<number>();
    inValueArea.add(pocIdx);
    let currentVaVol = bucketVol[pocIdx];

    let upper = pocIdx;
    let lower = pocIdx;
    while (currentVaVol < totalVol * 0.70 && (upper < priceBuckets - 1 || lower > 0)) {
      const upperVol = upper < priceBuckets - 1 ? bucketVol[upper + 1] : 0;
      const lowerVol = lower > 0 ? bucketVol[lower - 1] : 0;
      if (upperVol >= lowerVol && upper < priceBuckets - 1) {
        upper++;
        inValueArea.add(upper);
        currentVaVol += upperVol;
      } else if (lower > 0) {
        lower--;
        inValueArea.add(lower);
        currentVaVol += lowerVol;
      } else {
        break;
      }
    }

    const VAH = bucketMaxPrice[upper];
    const VAL = bucketMinPrice[lower];
    const POC = bucketMinPrice[pocIdx] + binSize / 2;

    // Draw guidelines on main chart
    const drawGuideline = (priceVal: number, color: string, label: string) => {
      const y = padT + cH * (1 - (priceVal - minPrice) / inner);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = color;
      ctx.font = 'bold 8px monospace';
      ctx.fillText(label, padL + 4, y - 3);
    };

    drawGuideline(VAH, 'rgba(59, 130, 246, 0.5)', 'VAH');
    drawGuideline(VAL, 'rgba(59, 130, 246, 0.5)', 'VAL');
    drawGuideline(POC, 'rgba(239, 68, 68, 0.6)', 'POC');

    // Draw Volume Profile bars on Sidebar
    bucketVol.forEach((v, index) => {
      const bH = cH / priceBuckets;
      const y = padT + cH - (index + 1) * bH;
      const barW = (vpW - 12) * (v / maxBucketVol);

      const isVA = inValueArea.has(index);
      const buyRatio = bucketBuyVol[index] / (v || 1);
      const buyBarW = barW * buyRatio;
      const sellBarW = barW - buyBarW;

      if (isVA) {
        // High opacity blue & red for VA
        vpCtx.fillStyle = 'rgba(59, 130, 246, 0.45)';
        vpCtx.fillRect(2, y + 1.5, buyBarW, bH - 2);

        vpCtx.fillStyle = 'rgba(239, 68, 68, 0.25)';
        vpCtx.fillRect(2 + buyBarW, y + 1.5, sellBarW, bH - 2);
      } else {
        // Muted tones for non-VA
        vpCtx.fillStyle = 'rgba(148, 163, 184, 0.20)';
        vpCtx.fillRect(2, y + 1.5, buyBarW, bH - 2);

        vpCtx.fillStyle = 'rgba(239, 68, 68, 0.08)';
        vpCtx.fillRect(2 + buyBarW, y + 1.5, sellBarW, bH - 2);
      }

      // Border outline
      vpCtx.strokeStyle = isVA ? 'rgba(71, 85, 105, 0.18)' : 'rgba(148, 163, 184, 0.08)';
      vpCtx.lineWidth = 0.5;
      vpCtx.strokeRect(2, y + 1.5, barW, bH - 2);
    });

    // Draw Sidebar POC line
    const bH = cH / priceBuckets;
    const sidebarPocY = padT + cH - (pocIdx + 0.5) * bH;
    vpCtx.strokeStyle = '#ef4444';
    vpCtx.lineWidth = 1.5;
    vpCtx.beginPath();
    vpCtx.moveTo(0, sidebarPocY);
    vpCtx.lineTo(vpW, sidebarPocY);
    vpCtx.stroke();

    // Red node marker dot
    vpCtx.fillStyle = '#ef4444';
    vpCtx.beginPath();
    vpCtx.arc(4, sidebarPocY, 3, 0, Math.PI * 2);
    vpCtx.fill();

    vpCtx.fillStyle = '#ef4444';
    vpCtx.font = 'bold 8px monospace';
    vpCtx.fillText('POC', 10, sidebarPocY - 2);

    // Draw Sidebar VAH and VAL lines
    const vahSideY = padT + cH * (1 - (VAH - minPrice) / inner);
    const valSideY = padT + cH * (1 - (VAL - minPrice) / inner);
    vpCtx.strokeStyle = 'rgba(59, 130, 246, 0.7)';
    vpCtx.lineWidth = 1;
    vpCtx.setLineDash([2, 2]);

    vpCtx.beginPath();
    vpCtx.moveTo(0, vahSideY);
    vpCtx.lineTo(vpW, vahSideY);
    vpCtx.stroke();

    vpCtx.beginPath();
    vpCtx.moveTo(0, valSideY);
    vpCtx.lineTo(vpW, valSideY);
    vpCtx.stroke();
    vpCtx.setLineDash([]);

    vpCtx.fillStyle = '#1d4ed8';
    vpCtx.font = 'bold 7px monospace';
    vpCtx.fillText('VAH', 10, vahSideY - 3);
    vpCtx.fillText('VAL', 10, valSideY + 8);

    // Draw HTF Candlesticks
    const totalBarW = cW / htfCandles.length;
    const barWText = Math.max(2, Math.floor(totalBarW * 0.65));

    htfCandles.forEach((c, idx) => {
      const x = padL + idx * totalBarW + totalBarW / 2;
      const yO = padT + cH * (1 - (c.open - minPrice) / inner);
      const yC = padT + cH * (1 - (c.close - minPrice) / inner);
      const yH = padT + cH * (1 - (c.high - minPrice) / inner);
      const yL = padT + cH * (1 - (c.low - minPrice) / inner);

      const isGreen = c.close >= c.open;
      ctx.strokeStyle = isGreen ? '#10b981' : '#f43f5e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yH);
      ctx.lineTo(x, yL);
      ctx.stroke();

      ctx.fillStyle = isGreen ? '#10b981' : '#f43f5e';
      ctx.fillRect(x - barWText / 2, Math.min(yO, yC), barWText, Math.max(1, Math.abs(yO - yC)));
    });

    // Draw swings breaks BoS / CHoCH
    htfSwings.forEach(sw => {
      if (sw.index < htfCandles.length) {
        const x = padL + sw.index * totalBarW + totalBarW / 2;
        const y = padT + cH * (1 - (sw.price - minPrice) / inner);

        ctx.strokeStyle = '#a1a1aa';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x - 15, y);
        ctx.lineTo(x + 40, y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = sw.type === 'CHoCH' ? '#b45309' : '#1d4ed8';
        ctx.font = 'bold 9px monospace';
        ctx.fillText(sw.type, x + 5, y - 4);
      }
    });

    // Draw price scale lines on price Y axis
    ctx.fillStyle = '#71717a';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 5; i++) {
      const val = maxPrice - (inner / 5) * i;
      const y = padT + (cH / 5) * i;
      ctx.fillText(`₹${Math.round(val)}`, w - padR + 5, y);
    }

    // Interactivity: hover guides & tooltip on sidebar
    if (hoverIndex !== null && hoverIndex < htfCandles.length) {
      const x = padL + hoverIndex * totalBarW + totalBarW / 2;
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h - padB);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (htfHoverPrice !== null) {
      // Draw horizontal crosshair on both frames
      const y = padT + cH * (1 - htfHoverPrice);
      const hoveredPriceVal = minPrice + htfHoverPrice * inner;

      ctx.strokeStyle = 'rgba(113, 113, 122, 0.4)';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw horizontal hover guide details on volume profile sidebar
      vpCtx.strokeStyle = 'rgba(113, 113, 122, 0.4)';
      vpCtx.setLineDash([2, 2]);
      vpCtx.beginPath();
      vpCtx.moveTo(0, y);
      vpCtx.lineTo(vpW, y);
      vpCtx.stroke();
      vpCtx.setLineDash([]);

      // Price indicator on sidebar/axis
      ctx.fillStyle = '#18181b';
      ctx.fillRect(w - padR + 2, y - 6, padR - 4, 12);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8px monospace';
      ctx.fillText(Math.round(hoveredPriceVal).toString(), w - padR + 5, y + 3);

      // Render Volume profile hover tooltip inside the volume sidebar itself!
      const hoverBinIdx = Math.floor((hoveredPriceVal - minPrice) / binSize);
      if (hoverBinIdx >= 0 && hoverBinIdx < priceBuckets) {
        const binVolVal = bucketVol[hoverBinIdx];
        const minBinP = bucketMinPrice[hoverBinIdx];
        const maxBinP = bucketMaxPrice[hoverBinIdx];
        const buyRVal = bucketBuyVol[hoverBinIdx] / (binVolVal || 1);

        const tooltipY = y < h / 2 ? y + 10 : y - 40;
        
        vpCtx.fillStyle = 'rgba(24, 24, 27, 0.9)';
        vpCtx.strokeStyle = 'rgba(228, 228, 231, 0.2)';
        vpCtx.lineWidth = 1;
        const tooltipW = 110;
        const tooltipX = vpW - tooltipW - 5;
        vpCtx.beginPath();
        vpCtx.roundRect(tooltipX, tooltipY, tooltipW, 35, 4);
        vpCtx.fill();
        vpCtx.stroke();

        vpCtx.fillStyle = '#ffffff';
        vpCtx.font = '7px monospace';
        vpCtx.textAlign = 'left';
        vpCtx.fillText(`Range: ${Math.round(minBinP)}-${Math.round(maxBinP)}`, tooltipX + 4, tooltipY + 9);
        vpCtx.fillText(`Vol: ${formatVolume(binVolVal)}`, tooltipX + 4, tooltipY + 17);
        vpCtx.fillText(`Buy: ${Math.round(buyRVal * 100)}% | Sell: ${Math.round((1 - buyRVal) * 100)}%`, tooltipX + 4, tooltipY + 25);
      }
    }

  }, [dimensions, hoverIndex, htfHoverPrice]);

  // Draw Lower Timeframe (1-Minute Ticks) Panel with Horizontal Volume Profile Sidebar
  useEffect(() => {
    const ltfCanvas = ltfCanvasRef.current;
    const ltfVolumeCanvas = ltfVolumeCanvasRef.current;
    if (!ltfCanvas || !ltfVolumeCanvas || spotCandles.length === 0) return;

    const ctx = ltfCanvas.getContext('2d');
    const vpCtx = ltfVolumeCanvas.getContext('2d');
    if (!ctx || !vpCtx) return;

    const rect = ltfCanvas.parentElement!.getBoundingClientRect();
    const w = Math.floor(rect.width) || 300;
    const h = Math.floor(rect.height) || 300;

    const vpRect = ltfVolumeCanvas.parentElement!.getBoundingClientRect();
    const vpW = Math.floor(vpRect.width) || 80;
    const vpH = Math.floor(vpRect.height) || 300;

    ltfCanvas.width = w;
    ltfCanvas.height = h;

    ltfVolumeCanvas.width = vpW;
    ltfVolumeCanvas.height = vpH;

    ctx.clearRect(0, 0, w, h);
    vpCtx.clearRect(0, 0, vpW, vpH);

    const padL = 15;
    const padR = 45;
    const padT = 30;
    const padB = 25;

    const cW = w - padL - padR;
    const cH = h - padT - padB;

    // Draw grid on Main Chart
    ctx.strokeStyle = '#f4f4f5';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const y = padT + (cH / 6) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
    }

    // Draw grid on Volume Profile Sidebar too
    vpCtx.strokeStyle = '#f4f4f5';
    vpCtx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const y = padT + (cH / 6) * i;
      vpCtx.beginPath();
      vpCtx.moveTo(0, y);
      vpCtx.lineTo(vpW, y);
      vpCtx.stroke();
    }

    const prices = spotCandles.flatMap(c => [c.low, c.high]);
    let minPrice = Math.min(...prices);
    let maxPrice = Math.max(...prices);
    const diff = maxPrice - minPrice || 1;
    minPrice -= diff * 0.05;
    maxPrice += diff * 0.05;
    const inner = maxPrice - minPrice;

    // Calculate Volume Profile Buckets
    const priceBuckets = 16;
    const bucketVol = new Array(priceBuckets).fill(0);
    const bucketBuyVol = new Array(priceBuckets).fill(0);
    const bucketMinPrice = new Array(priceBuckets);
    const bucketMaxPrice = new Array(priceBuckets);

    const binSize = inner / priceBuckets;
    for (let i = 0; i < priceBuckets; i++) {
      bucketMinPrice[i] = minPrice + i * binSize;
      bucketMaxPrice[i] = minPrice + (i + 1) * binSize;
    }

    spotCandles.forEach(c => {
      const isGreen = c.close >= c.open;
      const idx = Math.min(priceBuckets - 1, Math.floor(((c.close - minPrice) / inner) * priceBuckets));
      if (idx >= 0 && idx < priceBuckets) {
        bucketVol[idx] += c.volume;
        if (isGreen) {
          bucketBuyVol[idx] += c.volume * 0.58; 
        } else {
          bucketBuyVol[idx] += c.volume * 0.38;
        }
      }
    });

    const maxBucketVol = Math.max(...bucketVol, 1);
    const totalVol = bucketVol.reduce((a, b) => a + b, 0) || 1;

    // Identify Point of Control (POC)
    let pocIdx = 0;
    let maxVol = 0;
    for (let i = 0; i < priceBuckets; i++) {
      if (bucketVol[i] > maxVol) {
        maxVol = bucketVol[i];
        pocIdx = i;
      }
    }

    // Identify Value Area (contributing to 70% of volume)
    const inValueArea = new Set<number>();
    inValueArea.add(pocIdx);
    let currentVaVol = bucketVol[pocIdx];

    let upper = pocIdx;
    let lower = pocIdx;
    while (currentVaVol < totalVol * 0.70 && (upper < priceBuckets - 1 || lower > 0)) {
      const upperVol = upper < priceBuckets - 1 ? bucketVol[upper + 1] : 0;
      const lowerVol = lower > 0 ? bucketVol[lower - 1] : 0;
      if (upperVol >= lowerVol && upper < priceBuckets - 1) {
        upper++;
        inValueArea.add(upper);
        currentVaVol += upperVol;
      } else if (lower > 0) {
        lower--;
        inValueArea.add(lower);
        currentVaVol += lowerVol;
      } else {
        break;
      }
    }

    const VAH = bucketMaxPrice[upper];
    const VAL = bucketMinPrice[lower];
    const POC = bucketMinPrice[pocIdx] + binSize / 2;

    // Draw VAH, VAL, and POC guidelines on main chart
    const drawGuidelineLtf = (priceVal: number, color: string, label: string) => {
      const y = padT + cH * (1 - (priceVal - minPrice) / inner);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = color;
      ctx.font = 'bold 8px monospace';
      ctx.fillText(label, padL + 4, y - 3);
    };

    drawGuidelineLtf(VAH, 'rgba(16, 185, 129, 0.45)', 'VAH'); 
    drawGuidelineLtf(VAL, 'rgba(16, 185, 129, 0.45)', 'VAL');
    drawGuidelineLtf(POC, 'rgba(239, 68, 68, 0.6)', 'POC');

    // Draw Volume Profile bars on Sidebar
    bucketVol.forEach((v, index) => {
      const bH = cH / priceBuckets;
      const y = padT + cH - (index + 1) * bH;
      const barW = (vpW - 12) * (v / maxBucketVol);

      const isVA = inValueArea.has(index);
      const buyRatio = bucketBuyVol[index] / (v || 1);
      const buyBarW = barW * buyRatio;
      const sellBarW = barW - buyBarW;

      if (isVA) {
        vpCtx.fillStyle = 'rgba(16, 185, 129, 0.45)';
        vpCtx.fillRect(2, y + 1.5, buyBarW, bH - 2);

        vpCtx.fillStyle = 'rgba(239, 68, 68, 0.25)';
        vpCtx.fillRect(2 + buyBarW, y + 1.5, sellBarW, bH - 2);
      } else {
        vpCtx.fillStyle = 'rgba(148, 163, 184, 0.20)';
        vpCtx.fillRect(2, y + 1.5, buyBarW, bH - 2);

        vpCtx.fillStyle = 'rgba(239, 68, 68, 0.08)';
        vpCtx.fillRect(2 + buyBarW, y + 1.5, sellBarW, bH - 2);
      }

      vpCtx.strokeStyle = isVA ? 'rgba(71, 85, 105, 0.18)' : 'rgba(148, 163, 184, 0.08)';
      vpCtx.lineWidth = 0.5;
      vpCtx.strokeRect(2, y + 1.5, barW, bH - 2);
    });

    // Draw Sidebar POC line
    const bH = cH / priceBuckets;
    const sidebarPocY = padT + cH - (pocIdx + 0.5) * bH;
    vpCtx.strokeStyle = '#ef4444';
    vpCtx.lineWidth = 1.5;
    vpCtx.beginPath();
    vpCtx.moveTo(0, sidebarPocY);
    vpCtx.lineTo(vpW, sidebarPocY);
    vpCtx.stroke();

    vpCtx.fillStyle = '#ef4444';
    vpCtx.beginPath();
    vpCtx.arc(4, sidebarPocY, 3, 0, Math.PI * 2);
    vpCtx.fill();

    vpCtx.fillStyle = '#ef4444';
    vpCtx.font = 'bold 8px monospace';
    vpCtx.fillText('POC', 10, sidebarPocY - 2);

    // Draw Sidebar VAH and VAL lines
    const vahSideY = padT + cH * (1 - (VAH - minPrice) / inner);
    const valSideY = padT + cH * (1 - (VAL - minPrice) / inner);
    vpCtx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
    vpCtx.lineWidth = 1;
    vpCtx.setLineDash([2, 2]);

    vpCtx.beginPath();
    vpCtx.moveTo(0, vahSideY);
    vpCtx.lineTo(vpW, vahSideY);
    vpCtx.stroke();

    vpCtx.beginPath();
    vpCtx.moveTo(0, valSideY);
    vpCtx.lineTo(vpW, valSideY);
    vpCtx.stroke();
    vpCtx.setLineDash([]);

    vpCtx.fillStyle = '#0f766e';
    vpCtx.font = 'bold 7px monospace';
    vpCtx.fillText('VAH', 10, vahSideY - 3);
    vpCtx.fillText('VAL', 10, valSideY + 8);

    // Draw LTF Candlesticks
    const totalBarW = cW / spotCandles.length;
    const barWText = Math.max(2, Math.floor(totalBarW * 0.7));

    spotCandles.forEach((c, idx) => {
      const x = padL + idx * totalBarW + totalBarW / 2;
      const yO = padT + cH * (1 - (c.open - minPrice) / inner);
      const yC = padT + cH * (1 - (c.close - minPrice) / inner);
      const yH = padT + cH * (1 - (c.high - minPrice) / inner);
      const yL = padT + cH * (1 - (c.low - minPrice) / inner);

      const isGreen = c.close >= c.open;
      ctx.strokeStyle = isGreen ? '#10b981' : '#f43f5e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yH);
      ctx.lineTo(x, yL);
      ctx.stroke();

      ctx.fillStyle = isGreen ? '#10b981' : '#f43f5e';
      ctx.fillRect(x - barWText / 2, Math.min(yO, yC), barWText, Math.max(1, Math.abs(yO - yC)));
    });

    // Draw LTF Swings Breakouts
    ltfSwings.forEach(sw => {
      if (sw.index < spotCandles.length) {
        const x = padL + sw.index * totalBarW + totalBarW / 2;
        const y = padT + cH * (1 - (sw.price - minPrice) / inner);

        ctx.strokeStyle = '#a1a1aa';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x - 10, y);
        ctx.lineTo(x + 25, y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = sw.type === 'CHoCH' ? '#b45309' : '#1d4ed8';
        ctx.font = 'bold 8px monospace';
        ctx.fillText(sw.type, x + 3, y - 4);
      }
    });

    // Draw price scale lines on price Y axis
    ctx.fillStyle = '#71717a';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 5; i++) {
      const val = maxPrice - (inner / 5) * i;
      const y = padT + (cH / 5) * i;
      ctx.fillText(`₹${val.toFixed(1)}`, w - padR + 5, y);
    }

    // Interactivity logic
    if (hoverIndex !== null && hoverIndex < spotCandles.length) {
      const x = padL + hoverIndex * totalBarW + totalBarW / 2;
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h - padB);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (ltfHoverPrice !== null) {
      const y = padT + cH * (1 - ltfHoverPrice);
      const hoveredPriceVal = minPrice + ltfHoverPrice * inner;

      ctx.strokeStyle = 'rgba(113, 113, 122, 0.4)';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);

      vpCtx.strokeStyle = 'rgba(113, 113, 122, 0.4)';
      vpCtx.setLineDash([2, 2]);
      vpCtx.beginPath();
      vpCtx.moveTo(0, y);
      vpCtx.lineTo(vpW, y);
      vpCtx.stroke();
      vpCtx.setLineDash([]);

      ctx.fillStyle = '#111827';
      ctx.fillRect(w - padR + 2, y - 6, padR - 4, 12);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8px monospace';
      ctx.fillText(hoveredPriceVal.toFixed(1), w - padR + 4, y + 3);

      const hoverBinIdx = Math.floor((hoveredPriceVal - minPrice) / binSize);
      if (hoverBinIdx >= 0 && hoverBinIdx < priceBuckets) {
        const binVolVal = bucketVol[hoverBinIdx];
        const minBinP = bucketMinPrice[hoverBinIdx];
        const maxBinP = bucketMaxPrice[hoverBinIdx];
        const buyRVal = bucketBuyVol[hoverBinIdx] / (binVolVal || 1);

        const tooltipY = y < h / 2 ? y + 10 : y - 40;
        
        vpCtx.fillStyle = 'rgba(17, 24, 39, 0.9)';
        vpCtx.strokeStyle = 'rgba(228, 228, 231, 0.2)';
        vpCtx.lineWidth = 1;
        const tooltipW = 110;
        const tooltipX = vpW - tooltipW - 5;
        vpCtx.beginPath();
        vpCtx.roundRect(tooltipX, tooltipY, tooltipW, 35, 4);
        vpCtx.fill();
        vpCtx.stroke();

        vpCtx.fillStyle = '#ffffff';
        vpCtx.font = '7px monospace';
        vpCtx.textAlign = 'left';
        vpCtx.fillText(`Range: ${minBinP.toFixed(1)}-${maxBinP.toFixed(1)}`, tooltipX + 4, tooltipY + 9);
        vpCtx.fillText(`Vol: ${formatVolume(binVolVal)}`, tooltipX + 4, tooltipY + 17);
        vpCtx.fillText(`Buy: ${Math.round(buyRVal * 100)}% | Sell: ${Math.round((1 - buyRVal) * 100)}%`, tooltipX + 4, tooltipY + 25);
      }
    }

  }, [dimensions, spotCandles, hoverIndex, ltfHoverPrice]);

  // Handle coordinate shifts on main candlestick canvas mouse move
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>, type: 'HTF' | 'LTF') => {
    const canvas = type === 'HTF' ? htfCanvasRef.current : ltfCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const xMouse = e.clientX - rect.left;
    const yMouse = e.clientY - rect.top;

    const padL = 15;
    const padR = 45;
    const padT = 30;
    const padB = 25;
    const w = canvas.width;
    const h = canvas.height;
    const cW = w - padL - padR;
    const cH = h - padT - padB;

    // Synchronize hover timestamp index
    const totalBars = type === 'HTF' ? htfCandles.length : spotCandles.length;
    const unitStep = cW / totalBars;
    const index = Math.min(totalBars - 1, Math.max(0, Math.floor((xMouse - padL) / unitStep)));
    setHoverIndex(index);

    // Calculate vertical ratio position relative to chart core boundaries
    const relativeY = 1 - (yMouse - padT) / cH;
    if (relativeY >= 0 && relativeY <= 1) {
      if (type === 'HTF') {
        setHtfHoverPrice(relativeY);
      } else {
        setLtfHoverPrice(relativeY);
      }
    } else {
      if (type === 'HTF') setHtfHoverPrice(null);
      else setLtfHoverPrice(null);
    }
  };

  // Handle price shifts on moving mouse over volume profile sidebar
  const handleVolumeMouseMove = (e: React.MouseEvent<HTMLCanvasElement>, type: 'HTF' | 'LTF') => {
    const canvas = type === 'HTF' ? htfVolumeCanvasRef.current : ltfVolumeCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const yMouse = e.clientY - rect.top;

    const padT = 30;
    const padB = 25;
    const h = canvas.height;
    const cH = h - padT - padB;

    const relativeY = 1 - (yMouse - padT) / cH;
    if (relativeY >= 0 && relativeY <= 1) {
      if (type === 'HTF') {
        setHtfHoverPrice(relativeY);
      } else {
        setLtfHoverPrice(relativeY);
      }
    } else {
      if (type === 'HTF') setHtfHoverPrice(null);
      else setLtfHoverPrice(null);
    }
  };

  const handleMouseLeaveCombined = (type: 'HTF' | 'LTF') => {
    setHoverIndex(null);
    if (type === 'HTF') setHtfHoverPrice(null);
    else setLtfHoverPrice(null);
  };

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col gap-2 p-3 bg-white border border-zinc-200 rounded-lg shadow-xs">
      <div className="flex items-center justify-between border-b border-zinc-100 pb-2 px-1">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-850 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
          MARKET STRUCTURE ANALYSIS WORKSPACE
        </h3>
        <span className="text-[10px] font-mono text-zinc-450 hover:text-zinc-600">
          MICRO-TIME STRUCTURE & CONTINUOUS LIQUIDITY
        </span>
      </div>

      <div className="flex-1 flex flex-col md:flex-row gap-3 min-h-0">
        
        {/* HTF Canvas Box */}
        <div className="flex-1 flex flex-col bg-white rounded border border-zinc-200 overflow-hidden relative shadow-xs">
          <div className="bg-zinc-50/80 px-2.5 py-1.5 flex items-center justify-between border-b border-zinc-200/60">
            <span className="text-[10px] font-mono font-bold text-zinc-700">MACRO STRUCTURE TREND (1-Hour Candlestick)</span>
            <span className="text-[9px] bg-blue-50 border border-blue-105 rounded font-mono text-blue-700 font-bold px-1.5 animate-pulse">
              Volume Profile Active
            </span>
          </div>
          <div className="flex-1 flex min-h-0 relative">
            <div className="flex-1 relative min-h-0">
              <canvas
                ref={htfCanvasRef}
                className="absolute inset-0 cursor-crosshair h-full w-full"
                onMouseMove={(e) => handleMouseMove(e, 'HTF')}
                onMouseLeave={() => handleMouseLeaveCombined('HTF')}
              />
            </div>
            <div className="w-[80px] md:w-[100px] border-l border-zinc-150 flex flex-col relative min-h-0">
              <canvas
                ref={htfVolumeCanvasRef}
                className="absolute inset-0 cursor-crosshair h-full w-full bg-zinc-50/20"
                onMouseMove={(e) => handleVolumeMouseMove(e, 'HTF')}
                onMouseLeave={() => handleMouseLeaveCombined('HTF')}
              />
            </div>
          </div>
        </div>

        {/* LTF Canvas Box */}
        <div className="flex-1 flex flex-col bg-white rounded border border-zinc-200 overflow-hidden relative shadow-xs">
          <div className="bg-zinc-50/80 px-2.5 py-1.5 flex items-center justify-between border-b border-zinc-200/60">
            <span className="text-[10px] font-mono font-bold text-emerald-600">MICRO ENTRY PRECISION (1-Minute Candlestick)</span>
            <span className="text-[9px] bg-emerald-50 border border-emerald-100 rounded font-mono text-emerald-600 font-bold px-1.5 animate-pulse">
              Live Volume Profile
            </span>
          </div>
          <div className="flex-1 flex min-h-0 relative">
            <div className="flex-1 relative min-h-0">
              <canvas
                ref={ltfCanvasRef}
                className="absolute inset-0 cursor-crosshair h-full w-full"
                onMouseMove={(e) => handleMouseMove(e, 'LTF')}
                onMouseLeave={() => handleMouseLeaveCombined('LTF')}
              />
            </div>
            <div className="w-[80px] md:w-[100px] border-l border-zinc-150 flex flex-col relative min-h-0">
              <canvas
                ref={ltfVolumeCanvasRef}
                className="absolute inset-0 cursor-crosshair h-full w-full bg-zinc-50/20"
                onMouseMove={(e) => handleVolumeMouseMove(e, 'LTF')}
                onMouseLeave={() => handleMouseLeaveCombined('LTF')}
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
