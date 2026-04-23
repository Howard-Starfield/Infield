import { useState, type InputHTMLAttributes, type ReactElement, type ReactNode, cloneElement, isValidElement } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/**
 * HerOSInput — carved/recessed text input. Verbatim port from
 * `copy/src/components/HerOS.tsx`.
 *
 * Renders `.heros-input-wrapper` (defined in `src/styles/heros.css`)
 * with optional leading icon + automatic password show/hide toggle
 * when `type="password"`.
 *
 * Use this for **every text input across every page** — see
 * CLAUDE.md → HerOS Design System.
 */
export interface HerOSInputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode
}

export function HerOSInput({ icon, type, style, ...props }: HerOSInputProps) {
  const [showPassword, setShowPassword] = useState(false)
  const isPassword = type === 'password'

  return (
    <div className="heros-input-wrapper">
      {icon && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '16px',
            display: 'flex',
            alignItems: 'center',
            pointerEvents: 'none',
          }}
        >
          {isValidElement(icon)
            ? cloneElement(icon as ReactElement, { className: 'heros-icon-animate-focus' } as never)
            : icon}
        </div>
      )}
      <input
        type={isPassword ? (showPassword ? 'text' : 'password') : type}
        style={{
          paddingLeft: icon ? '44px' : '16px',
          paddingRight: isPassword ? '44px' : '16px',
          ...style,
        }}
        {...props}
      />
      {isPassword && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            right: '12px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            style={{
              color: 'var(--heros-text-muted)',
              padding: '4px',
              display: 'flex',
              cursor: 'pointer',
              background: 'none',
              border: 'none',
            }}
          >
            {showPassword ? <EyeOff size={18} strokeWidth={2.5} /> : <Eye size={18} strokeWidth={2.5} />}
          </button>
        </div>
      )}
    </div>
  )
}
