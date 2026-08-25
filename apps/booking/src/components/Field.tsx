interface FieldProps {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  required?: boolean;
}

export function Field({ label, htmlFor, children, required }: FieldProps) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full rounded-brand border border-[#D0D5DD] px-3 py-2 text-sm focus-visible:border-[var(--haip-primary,#0D9488)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--haip-primary,#0D9488)]/30';
