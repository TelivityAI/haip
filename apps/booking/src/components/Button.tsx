interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function Button({ variant = 'primary', className = '', style, ...rest }: ButtonProps) {
  // Radius is themeable on every variant; the primary variant also takes its background and text
  // color from the theme so it matches the host site.
  const base =
    'inline-flex items-center justify-center rounded-brand px-4 py-2 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = {
    primary: 'hover:opacity-90',
    secondary: 'border border-gray-300 text-gray-800 hover:bg-gray-50',
    ghost: 'text-gray-600 hover:text-gray-900',
  }[variant];

  const themeStyle =
    variant === 'primary'
      ? {
          backgroundColor: 'var(--haip-primary, #06bdb4)',
          color: 'var(--haip-on-primary, #ffffff)',
        }
      : undefined;

  return (
    <button className={`${base} ${styles} ${className}`} style={{ ...themeStyle, ...style }} {...rest} />
  );
}
