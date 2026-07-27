import { ReactNode, ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

const variants = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-ring',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus:ring-destructive',
  outline: 'border border-input bg-card text-foreground hover:bg-muted focus:ring-ring',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 focus:ring-ring',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground focus:ring-ring',
  link: 'text-primary hover:text-primary/80 underline-offset-4 hover:underline focus:ring-ring',
};

const sizes = {
  default: 'h-10 px-4 py-2',
  sm: 'h-9 rounded-md px-3',
  lg: 'h-11 rounded-md px-8',
  icon: 'h-10 w-10',
};

export function Button({
  children,
  variant = 'default',
  size = 'default',
  className = '',
  ...props
}: ButtonProps) {
  const variantClasses = variants[variant];
  const sizeClasses = sizes[size];

  return (
    <button
      className={`inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${variantClasses} ${sizeClasses} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
