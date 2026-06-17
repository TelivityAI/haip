interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = {
    primary: 'text-white hover:opacity-90',
    secondary: 'border border-gray-300 text-gray-800 hover:bg-gray-50',
    ghost: 'text-gray-600 hover:text-gray-900',
  }[variant];

  const inlineStyle =
    variant === 'primary' ? { backgroundColor: 'var(--haip-primary, #06bdb4)' } : undefined;

  return <button className={`${base} ${styles} ${className}`} style={inlineStyle} {...rest} />;
}
