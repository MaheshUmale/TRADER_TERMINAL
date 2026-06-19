import React, { useRef, useEffect, useState } from 'react';
import { useTerminalStore } from '../store';
import { Candlestick } from '../types';

interface ChartProps {
  symbol: string;
  candles: Candlestick[];
  type: 'SPOT' | 'CE' | 'PE';
  width: number;
  height: number;
}

export function ChartCandlestickCanvas({ symbol, candles, type, width, height }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoveredTime = useTerminalStore((state) => state.hoveredTime);
  const setHoveredTime = useTerminalStore((state) => state.setHoveredTime);

  // Panning & Zoom state
  const [zoomCount, setZoomCount] = useState<number>(60); // number of candlesticks in view
  const [scrollOffset, setScrollOffset] = useState<number>(0); // how many candles from the right edge we are scrolled back
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartX = useRef<number>(0);
  const dragStartScrollOffset = useRef<number>(0);

  // If new candles are added, ensure scrollOffset is clamped within bounds
  const maxScrollOffset = Math.max(0, candles.length - 15);
  const activeScrollOffset = Math.min(scrollOffset, maxScrollOffset);

  // Sliced candles for the current viewport slice
  const endIndex = Math.max(0, candles.length - activeScrollOffset);
  const startIndex = Math.max(0, endIndex - zoomCount);
  const slicedCandles = candles.slice(startIndex, endIndex);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || slicedCandles.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear old drawings
    ctx.clearRect(0, 0, width, height);

    const paddingLeft = 10;
    const paddingRight = 45;
    const paddingTop = 20;
    const paddingBottom = 20;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    // Draw grid lines
    ctx.strokeStyle = '#f4f4f5'; // light zinc-100 grid lines
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const y = paddingTop + (chartHeight / 6) * i;
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(width - paddingRight, y);
      ctx.stroke();
    }

    // Get min and max price ranges of the sliced view
    const prices = slicedCandles.flatMap((c) => [c.low, c.high]);
    let minPrice = Math.min(...prices);
    let maxPrice = Math.max(...prices);
    const priceDiff = maxPrice - minPrice || 1;
    
    // Add 10% vertical pad cushion
    minPrice -= priceDiff * 0.05;
    maxPrice += priceDiff * 0.05;
    const innerDiff = maxPrice - minPrice;

    // Open interest overlays boundaries in the sliced view
    const ois = slicedCandles.map((c) => c.oi || 0);
    const maxOI = Math.max(...ois, 1);

    // Render bars horizontal widths based on slicedCandles count
    const barWidth = Math.max(1.5, Math.floor(chartWidth / slicedCandles.length) - 1.5);
    const totalBarWidth = chartWidth / slicedCandles.length;

    // Draw Price / Volume / OI content
    slicedCandles.forEach((candle, index) => {
      const x = paddingLeft + index * totalBarWidth;
      const yOpen = paddingTop + chartHeight * (1 - (candle.open - minPrice) / innerDiff);
      const yClose = paddingTop + chartHeight * (1 - (candle.close - minPrice) / innerDiff);
      const yHigh = paddingTop + chartHeight * (1 - (candle.high - minPrice) / innerDiff);
      const yLow = paddingTop + chartHeight * (1 - (candle.low - minPrice) / innerDiff);

      const isGreen = candle.close >= candle.open;

      // Render OI Overlay bars in background
      if (type !== 'SPOT' && candle.oi) {
        const oiRatio = candle.oi / maxOI;
        const barHeight = chartHeight * 0.25 * oiRatio;
        const yOI = height - paddingBottom - barHeight;
        ctx.fillStyle = 'rgba(212, 212, 216, 0.4)';
        ctx.fillRect(x, yOI, barWidth, barHeight);
      }

      // Draw Candlestick
      ctx.strokeStyle = isGreen ? '#10b981' : '#f43f5e';
      ctx.lineWidth = 1.3;

      // Draw shadow wick line
      ctx.beginPath();
      ctx.moveTo(x + barWidth / 2, yHigh);
      ctx.lineTo(x + barWidth / 2, yLow);
      ctx.stroke();

      // Draw Candle Body
      ctx.fillStyle = isGreen ? '#10b981' : '#f43f5e';
      ctx.fillRect(x, Math.min(yOpen, yClose), barWidth, Math.max(1, Math.abs(yOpen - yClose)));
    });

    // Draw Y Axis prices text label readouts
    ctx.fillStyle = '#71717a';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= 5; i++) {
      const value = maxPrice - (innerDiff / 5) * i;
      const y = paddingTop + (chartHeight / 5) * i;
      ctx.fillText(value.toFixed(1), width - 5, y);
    }

    // Draw dynamic locked synced crosshair references if hovered
    if (hoveredTime !== null) {
      const matchedIdx = slicedCandles.findIndex((c) => c.time === hoveredTime);
      if (matchedIdx >= 0) {
        const xCursor = paddingLeft + matchedIdx * totalBarWidth + barWidth / 2;
        
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        // Draw Vertical Crosshair line
        ctx.beginPath();
        ctx.moveTo(xCursor, 0);
        ctx.lineTo(xCursor, height - paddingBottom);
        ctx.stroke();

        ctx.setLineDash([]); // Reset line dashes

        // Render OHLC overlay metrics details at current hover
        const targetCandle = slicedCandles[matchedIdx];
        ctx.fillStyle = 'rgba(244, 244, 245, 0.95)';
        ctx.fillRect(paddingLeft + 5, 2, width - paddingRight - 15, 12);

        ctx.fillStyle = '#18181b';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(
          `O: ${targetCandle.open.toFixed(1)} H: ${targetCandle.high.toFixed(1)} L: ${targetCandle.low.toFixed(1)} C: ${targetCandle.close.toFixed(1)} V: ${targetCandle.volume}`,
          paddingLeft + 8,
          4
        );
      }
    }
  }, [slicedCandles, width, height, hoveredTime, type]);

  // Handle Mouse movement syncing trigger loops
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || slicedCandles.length === 0) return;
    
    const rect = canvas.getBoundingClientRect();
    const xMouse = e.clientX - rect.left;

    const paddingLeft = 10;
    const paddingRight = 45;
    const chartWidth = width - paddingLeft - paddingRight;
    const totalBarWidth = chartWidth / slicedCandles.length;

    if (isDragging) {
      const deltaX = e.clientX - dragStartX.current;
      const candlesShifted = Math.round(deltaX / totalBarWidth);
      const rawOffset = dragStartScrollOffset.current + candlesShifted;
      const parsedOffset = Math.max(0, Math.min(candles.length - 10, rawOffset));
      setScrollOffset(parsedOffset);
      return;
    }

    const hoverIndex = Math.min(
      slicedCandles.length - 1,
      Math.max(0, Math.floor((xMouse - paddingLeft) / totalBarWidth))
    );

    const matchCandidate = slicedCandles[hoverIndex];
    if (matchCandidate) {
      setHoveredTime(matchCandidate.time);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartScrollOffset.current = scrollOffset;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setHoveredTime(null);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    // Zoom in / out of timeframe view count
    const minZoom = 15;
    const maxZoom = Math.min(300, candles.length);
    const zoomDelta = e.deltaY > 0 ? 4 : -4;
    setZoomCount((prev) => Math.max(minZoom, Math.min(maxZoom, prev + zoomDelta)));
  };

  return (
    <div className="absolute inset-0 select-none group w-full h-full">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className={`absolute inset-0 cursor-crosshair w-full h-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      />
      
      {/* Helpful small panning tooltip overlay on hover */}
      <div className="absolute bottom-1 right-12 text-[8px] pointer-events-none opacity-0 group-hover:opacity-80 transition-opacity bg-zinc-900/90 text-zinc-100 px-1.5 py-0.5 rounded font-mono">
        Drag to scroll | Scroll to zoom
      </div>

      {activeScrollOffset > 0 && (
        <button
          onClick={() => {
            setScrollOffset(0);
            setZoomCount(60);
          }}
          className="absolute bottom-1 left-2 text-[9px] bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 px-1.5 py-0.5 rounded font-bold transition-all shadow-xs"
        >
          Go Live ⇄
        </button>
      )}
    </div>
  );
}
