import { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
  className?: string;
  onClick?: () => void;
}

const variants = {
  default: 'bg-lamp-50 text-lamp-800 border-lamp-200',
  secondary: 'bg-muted text-muted-foreground border-border',
  destructive: 'bg-red-100 text-red-800 border-red-200',
  outline: 'border border-border text-muted-foreground bg-card',
};

export function Badge({ children, variant = 'default', className = '', onClick }: BadgeProps) {
  const variantClasses = variants[variant];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${onClick ? 'cursor-pointer' : ''} ${variantClasses} ${className}`}
      onClick={onClick}
    >
      {children}
    </span>
  );
}
