import React, { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
}

interface ToastContextType {
  toast: (message: string, variant?: ToastVariant, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}

const VARIANT_CONFIG: Record<ToastVariant, { icon: typeof CheckCircle; color: string; bg: string }> = {
  success: { icon: CheckCircle, color: 'var(--success)', bg: 'rgba(16, 185, 129, 0.12)' },
  error:   { icon: AlertCircle, color: 'var(--error)',   bg: 'rgba(255, 180, 171, 0.12)' },
  info:    { icon: Info,        color: 'var(--primary)',  bg: 'rgba(192, 193, 255, 0.12)' },
  warning: { icon: AlertTriangle, color: 'var(--warning)', bg: 'rgba(245, 158, 11, 0.12)' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const addToast = useCallback((message: string, variant: ToastVariant = 'info', duration = 4000) => {
    const id = `toast-${++counterRef.current}`;
    setToasts(prev => {
      // Edge case: Limit max toasts to prevent screen clutter
      const next = [...prev, { id, message, variant, duration }];
      return next.slice(-5);
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      
      {/* Toast Container — Bottom Center */}
      <div 
        role="log" 
        aria-live="polite" 
        style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: 8,
          zIndex: 10000,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onRemove }: { toast: Toast, onRemove: () => void }) {
  const [isPaused, setIsPaused] = useState(false);
  const [timeLeft, setTimeLeft] = useState(toast.duration);
  const timerRef = useRef<number | null>(null);
  const lastTickRef = useRef(Date.now());

  useEffect(() => {
    if (!isPaused) {
      lastTickRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        const delta = Date.now() - lastTickRef.current;
        setTimeLeft(prev => {
          const next = prev - delta;
          if (next <= 0) {
            clearInterval(timerRef.current!);
            onRemove();
            return 0;
          }
          lastTickRef.current = Date.now();
          return next;
        });
      }, 50);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, onRemove]);

  const config = VARIANT_CONFIG[toast.variant];
  const IconComponent = config.icon;

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: 'var(--surface-container-highest)',
        border: `1px solid rgba(255,255,255,0.08)`,
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        backdropFilter: 'blur(20px)',
        minWidth: 320,
        maxWidth: 480,
        animation: 'toastSlideUp 0.25s var(--ease-out)',
        pointerEvents: 'auto',
        position: 'relative',
        overflow: 'hidden',
        willChange: 'transform, opacity',
      }}
    >
      <IconComponent size={18} color={config.color} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--on-surface)', lineHeight: 1.4 }}>
        {toast.message}
      </span>
      <button
        onClick={onRemove}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--on-surface-variant)',
          cursor: 'pointer',
          padding: 4,
          display: 'flex',
          flexShrink: 0,
        }}
      >
        <X size={14} />
      </button>
      
      {/* Auto-dismiss progress bar */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        height: 2,
        background: config.color,
        width: `${(timeLeft / toast.duration) * 100}%`,
        transition: isPaused ? 'none' : 'width 50ms linear',
      }} />
    </div>
  );
}
